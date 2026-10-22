import Foundation

/// A login's one-time code, as the authenticator-style "2FA codes" list shows it.
public struct CodeEntry: Sendable, Identifiable {
	/// The login's item id.
	public var id: String
	/// The login's title, else the code's issuer, else the website, else the account.
	public var name: String
	/// The login's username, else the code's account name; empty when it would repeat the name.
	public var account: String
	public var totp: TotpParams
}

/// Every login with a valid one-time code, sorted by name, then account. With
/// `query`, only the codes whose name or account contains every word of it.
/// `items` are the vault's items outside the trash.
public func codeEntries(_ items: [(id: String, item: Item)], query: String = "") -> [CodeEntry] {
	let terms = query.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
	var result: [CodeEntry] = []
	for (id, item) in items {
		guard item.type == .login, !trim(item.totp).isEmpty, let totp = try? parseTotp(item.totp) else {
			continue
		}
		let account = nonEmpty(trim(item.username)) ?? trim(totp.account)
		let name = nonEmpty(trim(item.title)) ?? nonEmpty(trim(totp.issuer))
			?? nonEmpty(item.urls.isEmpty ? account : itemDisplayTitle(item)) ?? itemDisplayTitle(item)
		let entry = CodeEntry(id: id, name: name, account: account == name ? "" : account, totp: totp)
		let text = "\(entry.name) \(entry.account)".lowercased()
		if terms.allSatisfy({ text.contains($0) }) {
			result.append(entry)
		}
	}
	return result.sorted { a, b in
		let byName = compareText(a.name, b.name)
		if byName != .orderedSame {
			return byName == .orderedAscending
		}
		let byAccount = compareText(a.account, b.account)
		if byAccount != .orderedSame {
			return byAccount == .orderedAscending
		}
		return a.id < b.id
	}
}

public func codeEntries(_ items: [DecryptedItem], query: String = "") -> [CodeEntry] {
	codeEntries(items.filter { !$0.inTrash }.map { (id: $0.id, item: $0.item) }, query: query)
}

/// Case- and accent-insensitive, like core's `localeCompare` with base sensitivity.
private func compareText(_ a: String, _ b: String) -> ComparisonResult {
	a.compare(b, options: [.caseInsensitive, .diacriticInsensitive])
}

private func trim(_ text: String) -> String {
	text.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func nonEmpty(_ text: String) -> String? {
	text.isEmpty ? nil : text
}
