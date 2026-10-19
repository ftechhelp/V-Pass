import Clibsodium

/// Recovery key = 32 random bytes + 3-byte BLAKE2b checksum (35 bytes)
/// → 56 base32 characters, shown as 14 groups of 4: `ABCD-EFGH-…`.
/// The checksum lets us tell the user "typo" instead of "wrong key".
private let checksumBytes = 3
private let groupSize = 4

private func checksum(_ secret: Bytes) -> Bytes {
	sodiumReady()
	var hash = Bytes(repeating: 0, count: 16)
	_ = crypto_generichash(&hash, 16, secret, UInt64(secret.count), nil, 0)
	return Bytes(hash.prefix(checksumBytes))
}

public func formatRecoveryKey(_ secret: Bytes) -> String {
	let encoded = Array(base32Encode(secret + checksum(secret)))
	return stride(from: 0, to: encoded.count, by: groupSize)
		.map { String(encoded[$0..<min($0 + groupSize, encoded.count)]) }
		.joined(separator: "-")
}

/// Parse what the user typed or pasted. Tolerates case, spaces, dashes and 0/1/8 look-alikes.
public func parseRecoveryKey(_ input: String) throws -> Bytes {
	let normalised = String(input.uppercased().compactMap { char -> Character? in
		if char.isWhitespace || char == "-" {
			return nil
		}
		switch char {
		case "0": return "O"
		case "1": return "I"
		case "8": return "B"
		default: return char
		}
	})
	guard normalised.wholeMatch(of: /[A-Z2-7]{56}/) != nil else {
		throw InvalidRecoveryKeyError(.format)
	}
	let bytes = try base32Decode(normalised)
	let secret = Bytes(bytes.prefix(keyBytes))
	guard bytesEqual(Bytes(bytes.dropFirst(keyBytes)), checksum(secret)) else {
		throw InvalidRecoveryKeyError(.checksum)
	}
	return secret
}
