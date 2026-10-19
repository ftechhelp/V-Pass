import Foundation

/* ---------- display helpers (the bottom of items.ts) ---------- */

public func normaliseUrl(_ url: String) -> String {
	let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
	if trimmed.isEmpty {
		return ""
	}
	return trimmed.firstMatch(of: /^[a-zA-Z][a-zA-Z0-9+.\-]*:/) != nil ? trimmed : "https://\(trimmed)"
}

public func hostnameOf(_ url: String) -> String {
	guard let components = URLComponents(string: normaliseUrl(url)) else {
		return url.trimmingCharacters(in: .whitespacesAndNewlines)
	}
	let host = (components.host ?? "").lowercased()
	return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
}

public enum CardBrand: String, Sendable {
	case visa, mastercard, amex, discover, diners, jcb, unionpay, maestro, unknown
}

private func digitsOnly(_ text: String) -> String {
	text.filter(\.isASCIIDigit)
}

public func cardBrand(_ number: String) -> CardBrand {
	let n = digitsOnly(number)
	if n.firstMatch(of: /^4/) != nil { return .visa }
	if n.firstMatch(of: /^(5[1-5]|2(2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720))/) != nil { return .mastercard }
	if n.firstMatch(of: /^3[47]/) != nil { return .amex }
	if n.firstMatch(of: /^(6011|65|64[4-9])/) != nil { return .discover }
	if n.firstMatch(of: /^3(0[0-5]|[68])/) != nil { return .diners }
	if n.firstMatch(of: /^35(2[89]|[3-8])/) != nil { return .jcb }
	if n.firstMatch(of: /^62/) != nil { return .unionpay }
	if n.firstMatch(of: /^(5[06-9]|6\d)/) != nil { return .maestro }
	return .unknown
}

public func luhnValid(_ number: String) -> Bool {
	let digits = digitsOnly(number).compactMap(\.wholeNumberValue)
	guard digits.count >= 12 else {
		return false
	}
	var sum = 0
	for (i, digit) in digits.reversed().enumerated() {
		var d = digit
		if i % 2 == 1 {
			d *= 2
			if d > 9 { d -= 9 }
		}
		sum += d
	}
	return sum % 10 == 0
}

public func maskCardNumber(_ number: String) -> String {
	let digits = digitsOnly(number)
	return digits.count >= 4 ? "•••• \(digits.suffix(4))" : ""
}

public func formatCardNumber(_ number: String) -> String {
	let digits = Array(digitsOnly(number))
	let groups: [Int] = cardBrand(String(digits)) == .amex ? [4, 6, 5] : Array(repeating: 4, count: (digits.count + 3) / 4)
	var parts: [String] = []
	var index = 0
	for size in groups where index < digits.count {
		let end = min(index + size, digits.count)
		parts.append(String(digits[index..<end]))
		index = end
	}
	return parts.joined(separator: " ")
}

public func fullName(_ item: Item) -> String {
	[item.text("firstName"), item.text("middleName"), item.text("lastName")].filter { !$0.isEmpty }.joined(separator: " ")
}

public func itemSubtitle(_ item: Item) -> String {
	switch item.type {
	case .login:
		if !item.username.isEmpty { return item.username }
		if let url = item.urls.first, !hostnameOf(url).isEmpty { return hostnameOf(url) }
		return item.passkeys.isEmpty ? "" : "Passkey"
	case .card:
		let month = item.text("expMonth")
		let year = item.text("expYear")
		return [maskCardNumber(item.text("number")), !month.isEmpty && !year.isEmpty ? "\(month)/\(year.suffix(2))" : ""]
			.filter { !$0.isEmpty }.joined(separator: " · ")
	case .identity:
		let name = fullName(item)
		return name.isEmpty ? item.text("email") : name
	case .note:
		let line = item.notes.split(separator: "\n", omittingEmptySubsequences: false)
			.first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
		return line.map { String($0.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)) } ?? ""
	}
}

/// Lower-cased haystack for the search field.
public func itemSearchText(_ item: Item) -> String {
	var parts = [item.title, item.notes] + item.customFields.filter { $0.kind == .text }.map { "\($0.label) \($0.value)" }
	switch item.type {
	case .login:
		parts += [item.username] + item.urls + item.passkeys.map { "\($0.rpId) \($0.userName)" }
	case .card:
		parts += [item.text("cardholderName"), cardBrand(item.text("number")).rawValue, String(digitsOnly(item.text("number")).suffix(4))]
	case .identity:
		parts += [fullName(item), item.text("email"), item.text("phone"), item.text("company"), item.text("city"), item.text("country")]
	case .note:
		break
	}
	return parts.joined(separator: " ").lowercased()
}

public func itemDisplayTitle(_ item: Item) -> String {
	if !item.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
		return item.title
	}
	if item.type == .login, let url = item.urls.first {
		return hostnameOf(url)
	}
	return "Untitled"
}
