import Foundation

public typealias Bytes = [UInt8]

public func utf8Encode(_ text: String) -> Bytes {
	Array(text.utf8)
}

/// Strict UTF-8 decoding, like `TextDecoder('utf-8', { fatal: true })`.
public func utf8Decode(_ bytes: Bytes) throws -> String {
	guard let text = String(validating: bytes, as: UTF8.self) else {
		throw EncodingError("Invalid UTF-8")
	}
	return text
}

/// Base64url without padding (RFC 4648 §5). Used for every binary value on the wire.
public func b64urlEncode(_ bytes: Bytes) -> String {
	var text = Data(bytes).base64EncodedString()
	text = text.replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
	while text.hasSuffix("=") {
		text.removeLast()
	}
	return text
}

public func b64urlDecode(_ text: String) throws -> Bytes {
	let valid = text.utf8.allSatisfy { c in
		(c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39) || c == 0x2D || c == 0x5F
	}
	guard valid, text.utf8.count % 4 != 1 else {
		throw EncodingError("Invalid base64url string")
	}
	var b64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
	b64 += String(repeating: "=", count: (4 - b64.utf8.count % 4) % 4)
	guard let data = Data(base64Encoded: b64) else {
		throw EncodingError("Invalid base64url string")
	}
	return Bytes(data)
}

private let b32Alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")

/// RFC 4648 base32, uppercase, no padding.
public func base32Encode(_ bytes: Bytes) -> String {
	var bits = 0
	var value: UInt32 = 0
	var out = ""
	for byte in bytes {
		value = (value << 8) | UInt32(byte)
		bits += 8
		while bits >= 5 {
			out.append(b32Alphabet[Int((value >> UInt32(bits - 5)) & 31)])
			bits -= 5
		}
	}
	if bits > 0 {
		out.append(b32Alphabet[Int((value << UInt32(5 - bits)) & 31)])
	}
	return out
}

/// Lenient base32 decode: ignores case, whitespace, dashes and trailing padding.
public func base32Decode(_ text: String) throws -> Bytes {
	var clean = text.uppercased().filter { !$0.isWhitespace && $0 != "-" }
	while clean.hasSuffix("=") {
		clean.removeLast()
	}
	var out = Bytes()
	var bits = 0
	var value: UInt32 = 0
	for char in clean {
		guard let index = b32Alphabet.firstIndex(of: char) else {
			throw EncodingError("Invalid base32 character \"\(char)\"")
		}
		value = (value << 5) | UInt32(index)
		bits += 5
		if bits >= 8 {
			out.append(UInt8((value >> UInt32(bits - 8)) & 0xFF))
			bits -= 8
		}
	}
	return out
}

/// Constant-time comparison.
public func bytesEqual(_ a: Bytes, _ b: Bytes) -> Bool {
	guard a.count == b.count else {
		return false
	}
	var diff: UInt8 = 0
	for i in 0..<a.count {
		diff |= a[i] ^ b[i]
	}
	return diff == 0
}

public func hexEncode(_ bytes: Bytes) -> String {
	bytes.map { String(format: "%02x", $0) }.joined()
}
