import Clibsodium

/// Compact authenticated-encryption envelope: `1.<nonce>.<ciphertext>` (base64url parts).
/// Version 1 = XChaCha20-Poly1305-IETF with a random 192-bit nonce.
///
/// The AAD string binds a ciphertext to its purpose and object id, so the server
/// cannot swap blobs between items, folders or keys without detection.
private let envelopeVersion = "1"

public func seal(_ key: Bytes, _ plaintext: Bytes, aad: String) -> String {
	sodiumReady()
	precondition(key.count == Int(crypto_aead_xchacha20poly1305_ietf_KEYBYTES), "Envelope keys are 32 bytes")
	let nonce = randomBytes(Int(crypto_aead_xchacha20poly1305_ietf_NPUBBYTES))
	let ad = utf8Encode(aad)
	var ciphertext = Bytes(repeating: 0, count: plaintext.count + Int(crypto_aead_xchacha20poly1305_ietf_ABYTES))
	var length: UInt64 = 0
	_ = crypto_aead_xchacha20poly1305_ietf_encrypt(
		&ciphertext, &length,
		plaintext, UInt64(plaintext.count),
		ad, UInt64(ad.count),
		nil, nonce, key
	)
	return "\(envelopeVersion).\(b64urlEncode(nonce)).\(b64urlEncode(Bytes(ciphertext.prefix(Int(length)))))"
}

public func open(_ key: Bytes, _ envelope: String, aad: String) throws -> Bytes {
	sodiumReady()
	let parts = envelope.split(separator: ".", omittingEmptySubsequences: false)
	guard parts.count == 3, parts[0] == envelopeVersion else {
		throw DecryptionError("Unsupported or malformed envelope")
	}
	let nonce: Bytes
	let ciphertext: Bytes
	do {
		nonce = try b64urlDecode(String(parts[1]))
		ciphertext = try b64urlDecode(String(parts[2]))
	} catch {
		throw DecryptionError("Malformed envelope encoding")
	}
	guard nonce.count == Int(crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) else {
		throw DecryptionError("Malformed envelope nonce")
	}
	guard key.count == Int(crypto_aead_xchacha20poly1305_ietf_KEYBYTES),
		ciphertext.count >= Int(crypto_aead_xchacha20poly1305_ietf_ABYTES) else {
		throw DecryptionError()
	}
	let ad = utf8Encode(aad)
	var plaintext = Bytes(repeating: 0, count: ciphertext.count - Int(crypto_aead_xchacha20poly1305_ietf_ABYTES))
	var length: UInt64 = 0
	let result = crypto_aead_xchacha20poly1305_ietf_decrypt(
		&plaintext, &length, nil,
		ciphertext, UInt64(ciphertext.count),
		ad, UInt64(ad.count),
		nonce, key
	)
	guard result == 0 else {
		throw DecryptionError()
	}
	return Bytes(plaintext.prefix(Int(length)))
}

public func sealJSON(_ key: Bytes, _ value: JSONValue, aad: String) -> String {
	seal(key, utf8Encode(value.serialized()), aad: aad)
}

public func openJSON(_ key: Bytes, _ envelope: String, aad: String) throws -> JSONValue {
	try JSONValue.parse(utf8Decode(open(key, envelope, aad: aad)))
}

/// Same shape check as the server's Validator.
public func isEnvelope(_ text: String) -> Bool {
	text.wholeMatch(of: /1\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]+/) != nil
}
