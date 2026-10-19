import Clibsodium

/// libsodium is initialised once, on first use. Every crypto entry point calls `sodiumReady()`.
private let sodiumInitialised: Bool = sodium_init() >= 0

@inline(__always)
func sodiumReady() {
	precondition(sodiumInitialised, "libsodium could not be initialised")
}

/// Cryptographically secure random bytes.
public func randomBytes(_ count: Int) -> Bytes {
	sodiumReady()
	var out = Bytes(repeating: 0, count: count)
	out.withUnsafeMutableBytes { randombytes_buf($0.baseAddress!, count) }
	return out
}

/// Uniform random integer in [0, maxExclusive), without modulo bias.
public func randomInt(_ maxExclusive: Int) -> Int {
	precondition(maxExclusive > 0 && maxExclusive <= Int(UInt32.max), "maxExclusive out of range")
	sodiumReady()
	return Int(randombytes_uniform(UInt32(maxExclusive)))
}

/// RFC 4122 v4 UUID in lowercase, the form the server validates.
public func uuid() -> String {
	var b = randomBytes(16)
	b[6] = (b[6] & 0x0F) | 0x40
	b[8] = (b[8] & 0x3F) | 0x80
	let hex = hexEncode(b)
	let parts = [0..<8, 8..<12, 12..<16, 16..<20, 20..<32].map { range in
		String(hex[hex.index(hex.startIndex, offsetBy: range.lowerBound)..<hex.index(hex.startIndex, offsetBy: range.upperBound)])
	}
	return parts.joined(separator: "-")
}

/// Best-effort zeroing of key material that is no longer needed.
public func wipe(_ bytes: inout Bytes) {
	sodiumReady()
	bytes.withUnsafeMutableBytes { buffer in
		if let base = buffer.baseAddress {
			sodium_memzero(base, buffer.count)
		}
	}
}
