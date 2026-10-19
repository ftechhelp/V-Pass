import Foundation

/// What iOS's AutoFill needs from the vault, computed without any iOS API so it is
/// tested on Linux. The extension turns these into ASCredentialIdentity values.

public struct PasswordIdentity: Sendable, Hashable {
	/// Host of a saved URL (`github.com`), used as a `.domain` service identifier.
	public var host: String
	public var user: String
	/// The item id.
	public var recordIdentifier: String
}

public struct OneTimeCodeIdentity: Sendable, Hashable {
	public var host: String
	public var label: String
	public var recordIdentifier: String
}

public struct PasskeyIdentity: Sendable, Hashable {
	public var rpId: String
	public var userName: String
	public var credentialId: Bytes
	public var userHandle: Bytes
	/// The item id; the credential id picks the passkey inside it.
	public var recordIdentifier: String
}

public struct CredentialIdentities: Sendable, Equatable {
	public var passwords: [PasswordIdentity] = []
	public var oneTimeCodes: [OneTimeCodeIdentity] = []
	public var passkeys: [PasskeyIdentity] = []
}

/// The identities to register with iOS, from the items outside the trash. These
/// (sites and usernames, never secrets) are stored by iOS on the device so it can
/// suggest V-Pass in the keyboard bar; the Settings toggle turns this off.
public func credentialIdentities(for items: [DecryptedItem]) -> CredentialIdentities {
	var result = CredentialIdentities()
	var seenPasswords = Set<PasswordIdentity>()
	var seenCodes = Set<OneTimeCodeIdentity>()
	for entry in items.sorted(by: { $0.id < $1.id }) where !entry.inTrash && entry.item.type == .login {
		let item = entry.item
		let hosts = item.urls.compactMap { WebURL($0)?.hostname }
		let label = itemDisplayTitle(item)
		let hasTotp = !item.totp.isEmpty && (try? parseTotp(item.totp)) != nil
		for host in hosts {
			if !item.password.isEmpty {
				let identity = PasswordIdentity(host: host, user: item.username, recordIdentifier: entry.id)
				if seenPasswords.insert(identity).inserted {
					result.passwords.append(identity)
				}
			}
			if hasTotp {
				let identity = OneTimeCodeIdentity(host: host, label: label, recordIdentifier: entry.id)
				if seenCodes.insert(identity).inserted {
					result.oneTimeCodes.append(identity)
				}
			}
		}
		for passkey in item.passkeys where passkey.discoverable {
			guard let credentialId = try? b64urlDecode(passkey.credentialId) else {
				continue
			}
			result.passkeys.append(PasskeyIdentity(
				rpId: passkey.rpId,
				userName: passkey.userName.isEmpty ? item.username : passkey.userName,
				credentialId: credentialId,
				userHandle: (try? b64urlDecode(passkey.userHandle)) ?? [],
				recordIdentifier: entry.id
			))
		}
	}
	return result
}

/// iOS hands AutoFill service identifiers that are either a domain (`example.com`)
/// or a URL. Both become a page URL for `matchUrl`.
public func pageURL(forServiceIdentifier identifier: String) -> String {
	identifier.contains("://") ? identifier : "https://\(identifier)"
}

public struct RankedLogin: Sendable {
	public var entry: DecryptedItem
	public var match: UrlMatch
}

/// Logins (outside the trash) that match any of the service identifiers, best first.
public func rankLogins(_ items: [DecryptedItem], serviceIdentifiers: [String]) -> [RankedLogin] {
	let active = items.filter { !$0.inTrash }
	var best: [String: RankedLogin] = [:]
	var order: [String] = []
	for identifier in serviceIdentifiers {
		for match in matchLogins(active, pageUrl: pageURL(forServiceIdentifier: identifier), item: \.item) {
			if let current = best[match.entry.id] {
				let better = match.match.kind < current.match.kind || (match.match.kind == current.match.kind && current.match.insecure && !match.match.insecure)
				if better {
					best[match.entry.id] = RankedLogin(entry: match.entry, match: match.match)
				}
			} else {
				best[match.entry.id] = RankedLogin(entry: match.entry, match: match.match)
				order.append(match.entry.id)
			}
		}
	}
	return order.compactMap { best[$0] }.sorted { a, b in
		if a.match.kind != b.match.kind {
			return a.match.kind < b.match.kind
		}
		if a.match.insecure != b.match.insecure {
			return !a.match.insecure
		}
		return itemDisplayTitle(a.entry.item).localizedCaseInsensitiveCompare(itemDisplayTitle(b.entry.item)) == .orderedAscending
	}
}

public struct PasskeyEntry: Sendable {
	public var entry: DecryptedItem
	public var passkey: Passkey
}

/// Passkeys for `rpId` (honouring allowCredentials, base64url), newest first.
public func passkeys(in items: [DecryptedItem], rpId: String, allowCredentials: [String] = []) -> [PasskeyEntry] {
	items.filter { !$0.inTrash }
		.flatMap { entry in entry.item.passkeys.map { PasskeyEntry(entry: entry, passkey: $0) } }
		.filter { passkeyMatchesRequest($0.passkey, rpId: rpId, allowCredentials: allowCredentials) }
		.sorted { $0.passkey.createdAt > $1.passkey.createdAt }
}

/// Logins a new passkey for `rpId` could be added to (same site, no passkey for this user yet).
public func loginsForNewPasskey(in items: [DecryptedItem], rpId: String, userName: String) -> [DecryptedItem] {
	rankLogins(items, serviceIdentifiers: [rpId]).map(\.entry).filter { entry in
		!entry.item.passkeys.contains { $0.rpId == rpId && $0.userName == userName && !userName.isEmpty }
	}
}

/// A login holding `passkey`: added to `existing`, or a new login for the site.
public func itemWithPasskey(_ passkey: Passkey, adding existing: Item?, rpName: String) -> Item {
	if var item = existing {
		item.passkeys = item.passkeys + [passkey]
		if item.username.isEmpty {
			item.username = passkey.userName
		}
		return item
	}
	var item = Item.new(.login)
	item.title = rpName.isEmpty ? passkey.rpId : rpName
	item.username = passkey.userName
	item.urls = ["https://\(passkey.rpId)"]
	item.passkeys = [passkey]
	return item
}
