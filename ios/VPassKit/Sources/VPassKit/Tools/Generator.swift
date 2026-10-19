import Foundation

/// Password and passphrase generator (`tools/generator.ts`).
public struct PasswordOptions: Codable, Sendable, Equatable {
	public var length = 20
	public var lowercase = true
	public var uppercase = true
	public var digits = true
	public var symbols = true
	/// Leave out characters that are easy to confuse (Il1 O0 etc.).
	public var avoidAmbiguous = false

	public init() {}
}

public struct PassphraseOptions: Codable, Sendable, Equatable {
	public var words = 5
	public var separator = "-"
	public var capitalize = true
	public var includeNumber = true

	public init() {}
}

public let passwordLengthRange = 4...128
public let passphraseWordsRange = 3...20

private let ambiguous = Set("Il1O0o|`'\";:,.{}[]()/~")

private func activeSets(_ opts: PasswordOptions) -> [[Character]] {
	let sets: [(Bool, String)] = [
		(opts.lowercase, "abcdefghijklmnopqrstuvwxyz"),
		(opts.uppercase, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
		(opts.digits, "0123456789"),
		(opts.symbols, "!@#$%^&*()-_=+[]{};:,.?/~"),
	]
	return sets
		.filter(\.0)
		.map { _, chars in opts.avoidAmbiguous ? chars.filter { !ambiguous.contains($0) } : Array(chars) }
}

public struct GeneratorError: Error, LocalizedError {
	public var errorDescription: String? { "Select at least one character type" }
}

/// Random password guaranteed to contain at least one character from each selected set.
public func generatePassword(_ opts: PasswordOptions = PasswordOptions()) throws -> String {
	let sets = activeSets(opts)
	guard !sets.isEmpty else {
		throw GeneratorError()
	}
	let length = min(passwordLengthRange.upperBound, max(passwordLengthRange.lowerBound, opts.length, sets.count))
	let pool = sets.flatMap { $0 }
	// Rejection sampling keeps the output uniform over all valid passwords.
	while true {
		let out = (0..<length).map { _ in pool[randomInt(pool.count)] }
		if sets.allSatisfy({ set in out.contains { set.contains($0) } }) {
			return String(out)
		}
	}
}

/// EFF Large Wordlist (7776 words, CC BY 3.0 US, Electronic Frontier Foundation),
/// exported from core's `eff-wordlist.ts` by `npm run vectors:ios`.
public let effLargeWordlist: [String] = {
	guard let url = Bundle.module.url(forResource: "eff-wordlist", withExtension: "txt"),
		let text = try? String(contentsOf: url, encoding: .utf8) else {
		return []
	}
	return text.split(whereSeparator: \.isWhitespace).map(String.init)
}()

public func generatePassphrase(_ opts: PassphraseOptions = PassphraseOptions()) -> String {
	let list = effLargeWordlist
	precondition(!list.isEmpty, "The EFF word list is missing from the bundle")
	let count = min(passphraseWordsRange.upperBound, max(passphraseWordsRange.lowerBound, opts.words))
	var words = (0..<count).map { _ in
		let word = list[randomInt(list.count)]
		return opts.capitalize ? word.prefix(1).uppercased() + word.dropFirst() : word
	}
	if opts.includeNumber {
		let i = randomInt(words.count)
		words[i] += String(randomInt(10))
	}
	return words.joined(separator: opts.separator)
}

/// Approximate entropy in bits, for the "strength" readout.
public func passwordEntropyBits(_ opts: PasswordOptions) -> Int {
	let pool = activeSets(opts).reduce(0) { $0 + $1.count }
	return pool > 0 ? Int(floor(Double(max(opts.length, 0)) * log2(Double(pool)))) : 0
}

public func passphraseEntropyBits(_ opts: PassphraseOptions) -> Int {
	let perWord = log2(Double(max(effLargeWordlist.count, 1)))
	return Int(floor(Double(opts.words) * perWord + (opts.includeNumber ? log2(10 * Double(opts.words)) : 0)))
}
