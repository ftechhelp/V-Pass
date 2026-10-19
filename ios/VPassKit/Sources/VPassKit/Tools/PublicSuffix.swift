import Foundation

/// Public Suffix List lookups, the part of tldts that core uses
/// (`getDomain(host, { allowPrivateDomains: true })`). The list is bundled as
/// `Resources/public_suffix_list.dat`, ICANN and private sections both.
public struct PublicSuffixList: Sendable {
	private var exact: Set<String> = []
	/// `*.ck` is stored as `ck`.
	private var wildcard: Set<String> = []
	/// `!www.ck` is stored as `www.ck`.
	private var exception: Set<String> = []

	public init(rules text: String) {
		for line in text.split(whereSeparator: \.isNewline) {
			guard let rule = line.split(whereSeparator: \.isWhitespace).first.map({ $0.lowercased() }),
				!rule.isEmpty, !rule.hasPrefix("//") else {
				continue
			}
			if rule.hasPrefix("!") {
				exception.insert(String(rule.dropFirst()))
			} else if rule.hasPrefix("*.") {
				wildcard.insert(String(rule.dropFirst(2)))
			} else {
				exact.insert(rule)
			}
		}
	}

	public static let shared: PublicSuffixList = {
		guard let url = Bundle.module.url(forResource: "public_suffix_list", withExtension: "dat"),
			let text = try? String(contentsOf: url, encoding: .utf8) else {
			return PublicSuffixList(rules: "")
		}
		return PublicSuffixList(rules: text)
	}()

	/// The number of labels in the public suffix of `labels` (the default rule `*` counts as one).
	private func suffixLength(_ labels: [Substring]) -> Int {
		let count = labels.count
		// Exception rules win over every other matching rule.
		for i in 0..<count where exception.contains(labels[i...].joined(separator: ".")) {
			return count - i - 1
		}
		var longest = 1
		for i in 0..<count {
			let candidate = labels[i...].joined(separator: ".")
			if exact.contains(candidate) {
				longest = max(longest, count - i)
			}
			if i > 0 && wildcard.contains(candidate) {
				longest = max(longest, count - i + 1)
			}
		}
		return longest
	}

	public func publicSuffix(_ host: String) -> String? {
		let labels = Self.labels(host)
		guard !labels.isEmpty, !Self.isIPAddress(host) else {
			return nil
		}
		return labels.suffix(min(suffixLength(labels), labels.count)).joined(separator: ".")
	}

	/// eTLD+1 (`login.example.co.uk` → `example.co.uk`); nil for IPs, public suffixes and empty hosts.
	public func registrableDomain(_ host: String) -> String? {
		let labels = Self.labels(host)
		guard !labels.isEmpty, !Self.isIPAddress(host) else {
			return nil
		}
		let suffix = suffixLength(labels)
		guard suffix < labels.count else {
			return nil
		}
		return labels.suffix(suffix + 1).joined(separator: ".")
	}

	private static func labels(_ host: String) -> [Substring] {
		var host = host.lowercased()
		while host.hasSuffix(".") {
			host.removeLast()
		}
		let labels = host.split(separator: ".", omittingEmptySubsequences: false)
		return labels.contains(where: \.isEmpty) ? [] : labels
	}

	public static func isIPAddress(_ host: String) -> Bool {
		if host.contains(":") {
			return true
		}
		let parts = host.split(separator: ".", omittingEmptySubsequences: false)
		return parts.count == 4 && parts.allSatisfy { part in
			!part.isEmpty && part.count <= 3 && part.allSatisfy(\.isASCIIDigit) && (Int(part) ?? 256) <= 255
		}
	}
}

extension Character {
	var isASCIIDigit: Bool { isASCII && isNumber }
}
