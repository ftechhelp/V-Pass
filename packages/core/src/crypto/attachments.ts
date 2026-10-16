import { concatBytes, utf8Encode } from './encoding.ts'
import { DecryptionError } from './errors.ts'
import { na } from './sodium.ts'

/**
 * File encryption with libsodium secretstream (XChaCha20-Poly1305), 64 KiB chunks.
 * Layout: header (24 B) ‖ chunk₁ ‖ … ‖ chunkₙ, where the last chunk carries TAG_FINAL,
 * so truncation, reordering and appending are all detected.
 */
const CHUNK_SIZE = 64 * 1024

export function encryptStream(key: Uint8Array, data: Uint8Array, aad: string): Uint8Array {
	const s = na()
	const ad = utf8Encode(aad)
	const { state, header } = s.crypto_secretstream_xchacha20poly1305_init_push(key)
	const parts: Uint8Array[] = [header]
	let offset = 0
	do {
		const end = Math.min(offset + CHUNK_SIZE, data.length)
		const tag = end >= data.length
			? s.crypto_secretstream_xchacha20poly1305_TAG_FINAL
			: s.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE
		parts.push(s.crypto_secretstream_xchacha20poly1305_push(state, data.subarray(offset, end), ad, tag))
		offset = end
	} while (offset < data.length)
	return concatBytes(...parts)
}

export function decryptStream(key: Uint8Array, encrypted: Uint8Array, aad: string): Uint8Array {
	const s = na()
	const ad = utf8Encode(aad)
	const headerBytes = s.crypto_secretstream_xchacha20poly1305_HEADERBYTES
	const encChunk = CHUNK_SIZE + s.crypto_secretstream_xchacha20poly1305_ABYTES
	if (encrypted.length < headerBytes + s.crypto_secretstream_xchacha20poly1305_ABYTES) {
		throw new DecryptionError('Encrypted file is truncated')
	}
	let state
	try {
		state = s.crypto_secretstream_xchacha20poly1305_init_pull(encrypted.subarray(0, headerBytes), key)
	} catch {
		throw new DecryptionError('Invalid encrypted file header')
	}
	const parts: Uint8Array[] = []
	let offset = headerBytes
	let final = false
	while (offset < encrypted.length) {
		if (final) {
			throw new DecryptionError('Unexpected data after the final chunk')
		}
		const end = Math.min(offset + encChunk, encrypted.length)
		const result = s.crypto_secretstream_xchacha20poly1305_pull(state, encrypted.subarray(offset, end), ad)
		if (!result) {
			throw new DecryptionError('Encrypted file chunk failed authentication')
		}
		parts.push(result.message)
		final = result.tag === s.crypto_secretstream_xchacha20poly1305_TAG_FINAL
		offset = end
	}
	if (!final) {
		throw new DecryptionError('Encrypted file is truncated')
	}
	return concatBytes(...parts)
}
