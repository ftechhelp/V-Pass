import AuthenticationServices
import Observation
import SwiftUI
import VPassKit

/// One AutoFill request, from unlock to completion. iOS starts a fresh extension
/// process for most requests, so nothing here outlives the sheet: the vault key
/// comes from Face ID (or the master password) every time.
@Observable
@MainActor
final class AutoFillModel {
	enum Request {
		/// The user opened V-Pass from the AutoFill menu (passwords, plus passkeys when the site asked for one).
		case list([String], passkeys: ASPasskeyCredentialRequestParameters?)
		case oneTimeCodes([String])
		/// The user picked one of V-Pass's keyboard-bar suggestions.
		case provide(any ASCredentialRequest)
		case register(ASPasskeyCredentialRequest)
		case configure
	}

	enum Phase: Equatable {
		case starting
		case notConnected
		case locked
		case choosing
		case savePasskey
		case configured
		case failed(String)
	}

	private(set) var phase: Phase = .starting
	private(set) var request: Request?
	private(set) var snapshot: VaultSnapshot?
	private(set) var busy = false
	private(set) var unlockError: String?
	var search = ""

	let services = Services.current
	let settings = SettingsStore.load()
	private unowned let provider: ASCredentialProviderViewController
	private var session: VaultSession?

	init(provider: ASCredentialProviderViewController) {
		self.provider = provider
	}

	private var context: ASCredentialProviderExtensionContext { provider.extensionContext }

	var biometryName: String? {
		settings.biometricUnlock && services.biometrics.isAvailable ? services.biometrics.biometryName : nil
	}

	/// "github.com" for the unlock screen.
	var siteName: String? {
		switch request {
		case let .list(identifiers, passkeys): passkeys?.relyingPartyIdentifier ?? identifiers.first.map(hostname)
		case let .oneTimeCodes(identifiers): identifiers.first.map(hostname)
		case let .register(request): (request.credentialIdentity as? ASPasskeyCredentialIdentity)?.relyingPartyIdentifier
		case let .provide(request): request.credentialIdentity.serviceIdentifier.identifier
		case .configure, nil: nil
		}
	}

	private func hostname(_ identifier: String) -> String {
		WebHost.name(identifier)
	}

	/* ----- start and unlock ----- */

	func begin(_ request: Request) {
		self.request = request
		Task { await start() }
	}

	private func start() async {
		guard let account = services.accounts.load() else {
			phase = .notConnected
			return
		}
		do {
			session = try await services.session(for: account)
		} catch {
			phase = .failed(error.localizedDescription)
			return
		}
		phase = .locked
		if biometryName != nil {
			await unlockWithBiometrics()
		}
	}

	func unlockWithBiometrics() async {
		guard let session else { return }
		busy = true
		unlockError = nil
		defer { busy = false }
		do {
			guard let key = try await services.biometrics.load(reason: "Unlock V-Pass to fill \(siteName ?? "this field")") else {
				unlockError = "Open V-Pass and unlock with your master password to turn \(services.biometrics.biometryName) on again."
				return
			}
			try await session.unlock(vaultKey: key)
			await unlocked()
		} catch KeychainError.canceled {
		} catch {
			unlockError = error.localizedDescription
		}
	}

	func unlock(password: String) async {
		guard let session else { return }
		// AutoFill extensions get far less memory than apps; Argon2id at a high memory
		// setting would get the extension killed.
		if let meta = await session.cachedMeta, meta.kdf.memLimit > 64 * 1024 * 1024 {
			unlockError = "Your vault's key settings need more memory than AutoFill gets. Unlock in the V-Pass app and turn on \(services.biometrics.biometryName)."
			return
		}
		busy = true
		unlockError = nil
		defer { busy = false }
		do {
			try await session.unlock(password: password)
			await unlocked()
		} catch {
			unlockError = error.localizedDescription
		}
	}

	private func unlocked() async {
		guard let session else { return }
		// Pick up items added on other devices, but never keep the user waiting long.
		await withTimeout(seconds: 3) { _ = try? await session.sync() }
		do {
			snapshot = try await session.snapshot()
		} catch {
			phase = .failed(error.localizedDescription)
			return
		}
		if let items = snapshot?.items {
			let suggestions = settings.keyboardSuggestions
			Task { await IdentityStoreSync.update(items: items, suggestions: suggestions) }
		}
		switch request {
		case let .provide(request):
			provide(request)
		case let .register(request):
			prepareRegistration(request)
		case .configure:
			phase = .configured
		default:
			phase = .choosing
		}
	}

	/* ----- choosing ----- */

	var items: [DecryptedItem] { snapshot?.activeItems ?? [] }

	private var serviceIdentifiers: [String] {
		switch request {
		case let .list(identifiers, _), let .oneTimeCodes(identifiers): identifiers
		default: []
		}
	}

	var passkeyParameters: ASPasskeyCredentialRequestParameters? {
		if case let .list(_, parameters) = request {
			return parameters
		}
		return nil
	}

	var wantsCodes: Bool {
		if case .oneTimeCodes = request {
			return true
		}
		return false
	}

	private func usable(_ entry: DecryptedItem) -> Bool {
		guard entry.item.type == .login else { return false }
		return wantsCodes ? (try? parseTotp(entry.item.totp)) != nil : !entry.item.password.isEmpty
	}

	/// Logins for the site, best match first.
	var matches: [DecryptedItem] {
		rankLogins(items, serviceIdentifiers: serviceIdentifiers).map(\.entry).filter(usable)
	}

	/// Every other usable login, filtered by the search field.
	var others: [DecryptedItem] {
		let matched = Set(matches.map(\.id))
		let query = search.trimmingCharacters(in: .whitespaces).lowercased()
		return items
			.filter { usable($0) && !matched.contains($0.id) }
			.filter { query.isEmpty || itemSearchText($0.item).contains(query) }
			.sorted { itemDisplayTitle($0.item).localizedCaseInsensitiveCompare(itemDisplayTitle($1.item)) == .orderedAscending }
	}

	var passkeyMatches: [PasskeyEntry] {
		guard let parameters = passkeyParameters else { return [] }
		return passkeys(in: items, rpId: parameters.relyingPartyIdentifier, allowCredentials: parameters.allowedCredentials.map { b64urlEncode(Bytes($0)) })
	}

	func choose(_ entry: DecryptedItem) {
		if wantsCodes {
			completeCode(entry)
		} else {
			context.completeRequest(withSelectedCredential: ASPasswordCredential(user: entry.item.username, password: entry.item.password), completionHandler: nil)
		}
	}

	func choose(_ passkey: PasskeyEntry) {
		guard let parameters = passkeyParameters else { return }
		completeAssertion(passkey.passkey, rpId: parameters.relyingPartyIdentifier, clientDataHash: parameters.clientDataHash)
	}

	private func completeCode(_ entry: DecryptedItem) {
		guard let params = try? parseTotp(entry.item.totp) else {
			cancel(.credentialIdentityNotFound)
			return
		}
		context.completeOneTimeCodeRequest(using: ASOneTimeCodeCredential(code: totpCode(params).code), completionHandler: nil)
	}

	private func completeAssertion(_ passkey: Passkey, rpId: String, clientDataHash: Data) {
		do {
			let assertion = try getAssertion(passkey: passkey, rpId: rpId, clientDataHash: Bytes(clientDataHash))
			context.completeAssertionRequest(using: ASPasskeyAssertionCredential(
				userHandle: Data(assertion.userHandle),
				relyingParty: rpId,
				signature: Data(assertion.signature),
				clientDataHash: clientDataHash,
				authenticatorData: Data(assertion.authenticatorData),
				credentialID: Data(assertion.credentialId)
			), completionHandler: nil)
		} catch {
			phase = .failed(error.localizedDescription)
		}
	}

	/// A keyboard-bar suggestion: the record identifier is the item id.
	private func provide(_ request: any ASCredentialRequest) {
		let recordId = request.credentialIdentity.recordIdentifier
		let entry = items.first { $0.id == recordId }
		switch request.type {
		case .password:
			guard let entry else { return cancel(.credentialIdentityNotFound) }
			context.completeRequest(withSelectedCredential: ASPasswordCredential(user: entry.item.username, password: entry.item.password), completionHandler: nil)
		case .oneTimeCode:
			guard let entry else { return cancel(.credentialIdentityNotFound) }
			completeCode(entry)
		case .passkeyAssertion:
			guard let request = request as? ASPasskeyCredentialRequest,
				let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity else {
				return cancel(.failed)
			}
			let credentialId = b64urlEncode(Bytes(identity.credentialID))
			let candidates = entry.map { [$0] } ?? items
			guard let passkey = candidates.flatMap(\.item.passkeys).first(where: { $0.credentialId == credentialId && $0.rpId == identity.relyingPartyIdentifier }) else {
				return cancel(.credentialIdentityNotFound)
			}
			completeAssertion(passkey, rpId: identity.relyingPartyIdentifier, clientDataHash: request.clientDataHash)
		default:
			cancel(.failed)
		}
	}

	/* ----- saving a new passkey ----- */

	private(set) var registration: Registration?

	struct Registration {
		let request: ASPasskeyCredentialRequest
		let rpId: String
		let userName: String
		let userHandle: Bytes
		let algorithm: Int
		let targets: [DecryptedItem]
	}

	private func prepareRegistration(_ request: ASPasskeyCredentialRequest) {
		guard let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity else {
			return cancel(.failed)
		}
		let rpId = identity.relyingPartyIdentifier
		if case let .registration(input) = request.extensionInput, input.prf != nil || input.largeBlob != nil {
			phase = .failed("\(rpId) asks for a passkey feature V-Pass doesn't support (PRF or large blob). Save this passkey with another provider, such as iCloud Keychain.")
			return
		}
		let excluded = (request.excludedCredentials ?? []).map { b64urlEncode(Bytes($0.credentialID)) }
		if isExcluded(items.flatMap(\.item.passkeys), rpId: rpId, excludeCredentials: excluded) {
			return cancel(.matchedExcludedCredential)
		}
		guard let algorithm = chooseAlgorithm(request.supportedAlgorithms.map { $0.rawValue }) else {
			phase = .failed("\(rpId) asks for a key type V-Pass doesn't support.")
			return
		}
		registration = Registration(
			request: request,
			rpId: rpId,
			userName: identity.userName,
			userHandle: Bytes(identity.userHandle),
			algorithm: algorithm,
			targets: loginsForNewPasskey(in: items, rpId: rpId, userName: identity.userName)
		)
		phase = .savePasskey
	}

	/// Create the passkey and save it to the server *before* answering the site, so
	/// a site never holds a passkey that the vault lost.
	func savePasskey(into target: DecryptedItem?) async {
		guard let registration, let session else { return }
		busy = true
		defer { busy = false }
		do {
			let made = try createPasskey(
				rpId: registration.rpId,
				userHandle: registration.userHandle,
				userName: registration.userName,
				userDisplayName: registration.userName,
				algorithm: registration.algorithm
			)
			let passkey = made.passkey
			if let target {
				_ = try await session.modifyItem(id: target.id) { itemWithPasskey(passkey, adding: $0, rpName: "") }
			} else {
				_ = try await session.createItem(itemWithPasskey(passkey, adding: nil, rpName: ""))
			}
			if let items = try? await session.snapshot().items {
				await IdentityStoreSync.update(items: items, suggestions: settings.keyboardSuggestions)
			}
			context.completeRegistrationRequest(using: ASPasskeyRegistrationCredential(
				relyingParty: registration.rpId,
				clientDataHash: registration.request.clientDataHash,
				credentialID: Data(made.credentialId),
				attestationObject: Data(made.attestationObject)
			), completionHandler: nil)
		} catch {
			phase = .failed("The passkey was not created because V-Pass could not save it to your Nextcloud: \(error.localizedDescription)")
		}
	}

	/* ----- finishing ----- */

	func finishConfiguration() {
		context.completeExtensionConfigurationRequest()
	}

	func cancel(_ code: ASExtensionError.Code = .userCanceled) {
		if case .configure = request {
			context.completeExtensionConfigurationRequest()
		} else {
			context.cancelRequest(withError: ASExtensionError(code))
		}
	}
}

enum WebHost {
	/// "https://github.com/login" or "github.com" → "github.com"
	static func name(_ identifier: String) -> String {
		URLComponents(string: identifier.contains("://") ? identifier : "https://\(identifier)")?.host ?? identifier
	}
}

/// Run `operation`, but stop waiting for it after `seconds` (it keeps running in the background).
func withTimeout(seconds: Double, _ operation: @escaping @Sendable () async -> Void) async {
	let gate = OnceGate()
	await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
		Task {
			await operation()
			if gate.claim() { continuation.resume() }
		}
		Task {
			try? await Task.sleep(for: .seconds(seconds))
			if gate.claim() { continuation.resume() }
		}
	}
}

private final class OnceGate: @unchecked Sendable {
	private let lock = NSLock()
	private var done = false

	func claim() -> Bool {
		lock.withLock {
			if done { return false }
			done = true
			return true
		}
	}
}
