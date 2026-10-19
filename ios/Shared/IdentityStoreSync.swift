import AuthenticationServices
import VPassKit

/// Keeps iOS's AutoFill suggestions (the keyboard bar) in step with the vault.
/// Only sites, usernames, labels and passkey ids go to iOS, never secrets; the
/// "Keyboard suggestions" setting removes them all.
enum IdentityStoreSync {
	static func isEnabled() async -> Bool {
		await withCheckedContinuation { continuation in
			ASCredentialIdentityStore.shared.getState { state in
				continuation.resume(returning: state.isEnabled)
			}
		}
	}

	static func update(items: [DecryptedItem], suggestions: Bool) async {
		guard await isEnabled() else {
			return
		}
		let store = ASCredentialIdentityStore.shared
		guard suggestions else {
			await withCheckedContinuation { continuation in
				store.removeAllCredentialIdentities { _, _ in continuation.resume() }
			}
			return
		}
		let catalog = credentialIdentities(for: items)
		var identities: [any ASCredentialIdentity] = []
		for password in catalog.passwords {
			identities.append(ASPasswordCredentialIdentity(
				serviceIdentifier: ASCredentialServiceIdentifier(identifier: password.host, type: .domain),
				user: password.user,
				recordIdentifier: password.recordIdentifier
			))
		}
		for passkey in catalog.passkeys {
			identities.append(ASPasskeyCredentialIdentity(
				relyingPartyIdentifier: passkey.rpId,
				userName: passkey.userName,
				credentialID: Data(passkey.credentialId),
				userHandle: Data(passkey.userHandle),
				recordIdentifier: passkey.recordIdentifier
			))
		}
		for code in catalog.oneTimeCodes {
			identities.append(ASOneTimeCodeCredentialIdentity(
				serviceIdentifier: ASCredentialServiceIdentifier(identifier: code.host, type: .domain),
				label: code.label,
				recordIdentifier: code.recordIdentifier
			))
		}
		await withCheckedContinuation { continuation in
			store.replaceCredentialIdentities(identities) { _, _ in continuation.resume() }
		}
	}

	static func removeAll() async {
		await withCheckedContinuation { continuation in
			ASCredentialIdentityStore.shared.removeAllCredentialIdentities { _, _ in continuation.resume() }
		}
	}
}
