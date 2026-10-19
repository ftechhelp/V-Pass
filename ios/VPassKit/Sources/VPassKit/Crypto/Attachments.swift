import Clibsodium

/// File encryption with libsodium secretstream (XChaCha20-Poly1305), 64 KiB chunks.
/// Layout: header (24 B) ‖ chunk₁ ‖ … ‖ chunkₙ, where the last chunk carries TAG_FINAL,
/// so truncation, reordering and appending are all detected.
private let chunkSize = 64 * 1024

public func encryptStream(_ key: Bytes, _ data: Bytes, aad: String) -> Bytes {
	sodiumReady()
	let ad = utf8Encode(aad)
	var state = crypto_secretstream_xchacha20poly1305_state()
	var header = Bytes(repeating: 0, count: Int(crypto_secretstream_xchacha20poly1305_HEADERBYTES))
	_ = crypto_secretstream_xchacha20poly1305_init_push(&state, &header, key)
	var out = header
	let abytes = Int(crypto_secretstream_xchacha20poly1305_ABYTES)
	var offset = 0
	repeat {
		let end = min(offset + chunkSize, data.count)
		let tag = end >= data.count
			? UInt8(crypto_secretstream_xchacha20poly1305_TAG_FINAL)
			: UInt8(crypto_secretstream_xchacha20poly1305_TAG_MESSAGE)
		let chunk = Bytes(data[offset..<end])
		var encrypted = Bytes(repeating: 0, count: chunk.count + abytes)
		var length: UInt64 = 0
		_ = crypto_secretstream_xchacha20poly1305_push(&state, &encrypted, &length, chunk, UInt64(chunk.count), ad, UInt64(ad.count), tag)
		out += encrypted.prefix(Int(length))
		offset = end
	} while offset < data.count
	return out
}

public func decryptStream(_ key: Bytes, _ encrypted: Bytes, aad: String) throws -> Bytes {
	sodiumReady()
	let ad = utf8Encode(aad)
	let headerBytes = Int(crypto_secretstream_xchacha20poly1305_HEADERBYTES)
	let abytes = Int(crypto_secretstream_xchacha20poly1305_ABYTES)
	let encChunk = chunkSize + abytes
	guard encrypted.count >= headerBytes + abytes, key.count == keyBytes else {
		throw DecryptionError("Encrypted file is truncated")
	}
	var state = crypto_secretstream_xchacha20poly1305_state()
	let header = Bytes(encrypted.prefix(headerBytes))
	guard crypto_secretstream_xchacha20poly1305_init_pull(&state, header, key) == 0 else {
		throw DecryptionError("Invalid encrypted file header")
	}
	var out = Bytes()
	var offset = headerBytes
	var final = false
	while offset < encrypted.count {
		if final {
			throw DecryptionError("Unexpected data after the final chunk")
		}
		let end = min(offset + encChunk, encrypted.count)
		let chunk = Bytes(encrypted[offset..<end])
		var message = Bytes(repeating: 0, count: max(chunk.count - abytes, 0))
		var length: UInt64 = 0
		var tag: UInt8 = 0
		guard crypto_secretstream_xchacha20poly1305_pull(&state, &message, &length, &tag, chunk, UInt64(chunk.count), ad, UInt64(ad.count)) == 0 else {
			throw DecryptionError("Encrypted file chunk failed authentication")
		}
		out += message.prefix(Int(length))
		final = tag == UInt8(crypto_secretstream_xchacha20poly1305_TAG_FINAL)
		offset = end
	}
	if !final {
		throw DecryptionError("Encrypted file is truncated")
	}
	return out
}
