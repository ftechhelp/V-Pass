import AuthenticationServices
import Observation
import SwiftUI
import VPassKit

/// Everything the app's screens show and do. The vault key and decrypted items
/// live in the VaultSession actor; this model only holds the latest snapshot
/// while unlocked, and drops it when locking.
@Observable
@MainActor
final class AppModel {
	enum Phase: Equatable {
		case loading
		case connect
		case noVault
		case locked
		case unlocked
	}

	private(set) var phase: Phase = .loading
	private(set) var account: Account?
	private(set) var snapshot: VaultSnapshot?
	private(set) var busy = false
	private(set) var unlockError: String?
	private(set) var syncError: String?
	private(set) var lastSync: Date?
	private(set) var autoFillEnabled = false
	var banner: String?
	/// Saved by `settingsChanged(from:)`, which RootView calls on every change.
	var settings: AppSettings

	let services: Services
	private var session: VaultSession?
	private var backgroundedAt: Date?

	init(services: Services = .current) {
		self.services = services
		settings = AppGroup.isUITest ? AppSettings() : SettingsStore.load()
	}

	var biometryName: String? {
		services.biometrics.isAvailable && settings.biometricUnlock ? services.biometrics.biometryName : nil
	}

	var canUseBiometrics: Bool { services.biometrics.isAvailable }

	/* ----- start-up and connection ----- */

	func start() async {
		guard let account = services.accounts.load() else {
			phase = .connect
			return
		}
		await open(account)
	}

	private func open(_ account: Account) async {
		self.account = account
		do {
			let session = try await services.session(for: account)
			self.session = session
			if await session.cachedMeta == nil {
				// First launch for this account: find out whether a vault exists.
				phase = .loading
				try await session.sync()
				phase = await session.cachedMeta == nil ? .noVault : .locked
			} else {
				phase = .locked
				Task { await sync() }
			}
		} catch {
			syncError = error.localizedDescription
			phase = .locked
		}
		await refreshAutoFillState()
		if phase == .locked, biometryName != nil {
			await unlockWithBiometrics()
		}
	}

	func connected(_ account: Account) async {
		do {
			try services.accounts.save(account)
		} catch {
			banner = "Could not save the account: \(error.localizedDescription)"
			return
		}
		await open(account)
	}

	func checkForVaultAgain() async {
		guard let session else { return }
		busy = true
		defer { busy = false }
		do {
			try await session.sync()
			phase = await session.cachedMeta == nil ? .noVault : .locked
		} catch {
			banner = error.localizedDescription
		}
	}

	/// Revoke the app password (best effort) and forget everything on this device.
	func disconnect() async {
		if let account {
			await LoginFlow().revoke(account)
		}
		await session?.erase()
		services.biometrics.remove()
		services.accounts.delete()
		(services.store as? FileVaultStore)?.erase()
		await IdentityStoreSync.removeAll()
		session = nil
		account = nil
		snapshot = nil
		settings.biometricUnlock = false
		phase = .connect
	}

	/* ----- lock and unlock ----- */

	func unlock(password: String) async {
		await runUnlock {
			let key = try await $0.unlock(password: password)
			return key
		}
	}

	func unlock(recoveryKey: String) async {
		await runUnlock { try await $0.unlock(recoveryKey: recoveryKey) }
	}

	func unlockWithBiometrics() async {
		guard let session else { return }
		busy = true
		unlockError = nil
		defer { busy = false }
		do {
			guard let key = try await services.biometrics.load(reason: "Unlock your V-Pass vault") else {
				// iOS dropped the key (Face ID enrolment changed): fall back to the password.
				settings.biometricUnlock = false
				unlockError = "Unlock with your master password to turn \(services.biometrics.biometryName) on again."
				return
			}
			try await session.unlock(vaultKey: key)
			await didUnlock()
		} catch KeychainError.canceled {
			// The user chose the password instead.
		} catch is StaleVaultKeyError {
			services.biometrics.remove()
			settings.biometricUnlock = false
			unlockError = StaleVaultKeyError().localizedDescription
		} catch {
			unlockError = error.localizedDescription
		}
	}

	private func runUnlock(_ body: (VaultSession) async throws -> SecretKey) async {
		guard let session else { return }
		busy = true
		unlockError = nil
		defer { busy = false }
		do {
			let key = try await body(session)
			if settings.biometricUnlock {
				// Refresh the saved key (it may be from before a vault was recreated).
				try? services.biometrics.save(key.bytes)
			}
			await didUnlock()
		} catch {
			unlockError = error.localizedDescription
		}
	}

	private func didUnlock() async {
		unlockError = nil
		await refreshSnapshot()
		phase = .unlocked
		Task { await sync() }
	}

	func lock() {
		guard phase == .unlocked else { return }
		snapshot = nil
		phase = .locked
		Task { await session?.lock() }
	}

	func setBiometricUnlock(_ enabled: Bool) async {
		guard let session else { return }
		if enabled {
			do {
				try services.biometrics.save(try await session.currentVaultKey().bytes)
				settings.biometricUnlock = true
			} catch {
				banner = "Could not turn on \(services.biometrics.biometryName): \(error.localizedDescription)"
			}
		} else {
			services.biometrics.remove()
			settings.biometricUnlock = false
		}
	}

	/// Auto-lock: called on every scene phase change.
	func scenePhaseChanged(_ scenePhase: ScenePhase) {
		switch scenePhase {
		case .background:
			backgroundedAt = Date()
			if settings.autoLock == .immediately {
				lock()
			}
		case .active:
			if let backgroundedAt, Date().timeIntervalSince(backgroundedAt) >= TimeInterval(settings.autoLock.rawValue) {
				lock()
			}
			backgroundedAt = nil
			if phase == .unlocked || phase == .locked {
				Task {
					await refreshAutoFillState()
					await sync()
				}
			}
		default:
			break
		}
	}

	/* ----- vault data ----- */

	func sync() async {
		guard let session else { return }
		do {
			try await session.sync()
			syncError = nil
			lastSync = Date()
			if await !session.isUnlocked, phase == .unlocked {
				// The vault was deleted or recreated on another device.
				snapshot = nil
				phase = await session.cachedMeta == nil ? .noVault : .locked
				services.biometrics.remove()
				settings.biometricUnlock = false
				return
			}
			await refreshSnapshot()
		} catch {
			syncError = error.localizedDescription
		}
	}

	private func refreshSnapshot() async {
		guard let session, await session.isUnlocked else { return }
		do {
			let fresh = try await session.snapshot()
			snapshot = fresh
			await IdentityStoreSync.update(items: fresh.items, suggestions: settings.keyboardSuggestions)
		} catch {
			syncError = error.localizedDescription
		}
	}

	func item(_ id: String) -> DecryptedItem? {
		snapshot?.items.first { $0.id == id }
	}

	func create(_ item: Item) async throws -> DecryptedItem {
		guard let session else { throw LockedError() }
		let created = try await session.createItem(item)
		await refreshSnapshot()
		return created
	}

	/// Throws EditConflictError (with the server copy) when another device changed the item first.
	func save(id: String, base: DecryptedItem, edited: Item) async throws -> DecryptedItem {
		guard let session else { throw LockedError() }
		do {
			let saved = try await session.save(id: id, base: base, edited: edited)
			await refreshSnapshot()
			return saved
		} catch let conflict as EditConflictError {
			await refreshSnapshot()
			throw conflict
		}
	}

	func trash(_ id: String) async {
		await perform { try await $0.trash(id: id) }
	}

	func restore(_ id: String) async {
		await perform { try await $0.restore(id: id) }
	}

	func toggleFavorite(_ entry: DecryptedItem) async {
		var edited = entry.item
		edited.favorite.toggle()
		do {
			_ = try await save(id: entry.id, base: entry, edited: edited)
		} catch {
			banner = error.localizedDescription
		}
	}

	func createFolder(_ name: String) async -> String? {
		guard let session else { return nil }
		do {
			let id = try await session.createFolder(name: name)
			await refreshSnapshot()
			return id
		} catch {
			banner = error.localizedDescription
			return nil
		}
	}

	/// Store codes moved over from another authenticator app (the rows to import of
	/// `planAuthenticatorImport`): into their logins, or as new logins. `onSaved`
	/// counts each one, so a failure part-way can say how many were kept.
	func importAuthenticatorCodes(_ rows: [AuthenticatorPlanRow], onSaved: () -> Void) async throws {
		guard let session else { throw LockedError() }
		do {
			for row in rows {
				if let id = row.itemId {
					let totp = row.entry.totp
					_ = try await session.modifyItem(id: id) { item in
						guard item.type == .login else { return nil }
						var edited = item
						edited.totp = totp
						return edited
					}
				} else {
					_ = try await session.createItem(newLoginForAuthenticatorEntry(row.entry))
				}
				onSaved()
			}
		} catch {
			await refreshSnapshot()
			throw error
		}
		await refreshSnapshot()
	}

	private func perform(_ body: (VaultSession) async throws -> Void) async {
		guard let session else { return }
		do {
			try await body(session)
			await refreshSnapshot()
		} catch {
			banner = error.localizedDescription
		}
	}

	/* ----- conveniences ----- */

	func copy(_ text: String, label: String) {
		Clipboard.copy(text, clear: settings.clipboardClear)
		banner = settings.clipboardClear == .never ? "\(label) copied" : "\(label) copied · clears \(settings.clipboardClear.label.lowercased())"
	}

	func refreshAutoFillState() async {
		autoFillEnabled = await IdentityStoreSync.isEnabled()
	}

	func openAutoFillSettings() {
		Task {
			try? await ASSettingsHelper.openCredentialProviderAppSettings()
		}
	}

	func settingsChanged(from old: AppSettings) {
		if !AppGroup.isUITest {
			SettingsStore.save(settings)
		}
		if settings.keyboardSuggestions != old.keyboardSuggestions, let items = snapshot?.items {
			Task { await IdentityStoreSync.update(items: items, suggestions: settings.keyboardSuggestions) }
		}
	}
}
