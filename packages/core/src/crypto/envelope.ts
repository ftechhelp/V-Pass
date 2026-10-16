import { b64urlDecode, b64urlEncode, utf8Decode, utf8Encode } from './encoding.ts'
import { DecryptionError } from './errors.ts'
import { na } from './sodium.ts'

/**
 * Compact authenticated-encryption envelope: `1.<nonce>.<ciphertext>` (base64url parts).
 * Version 1 = XChaCha20-Poly1305-IETF with a random 192-bit nonce.
 *
 * The AAD string binds a ciphertext to its purpose and object id, so the server
 * cannot swap blobs between items, folders or keys without detection.
 */
const VERSION = '1'

export function seal(key: Uint8Array, plaintext: Uint8Array, aad: string): string {
	const s = na()
	const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
	const ciphertext = s.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, utf8Encode(aad), null, nonce, key)
	return `${VERSION}.${b64urlEncode(nonce)}.${b64urlEncode(ciphertext)}`
}

export function open(key: Uint8Array, envelope: string, aad: string): Uint8Array {
	const s = na()
	const parts = envelope.split('.')
	if (parts.length !== 3 || parts[0] !== VERSION) {
		throw new DecryptionError('Unsupported or malformed envelope')
	}
	let nonce: Uint8Array
	let ciphertext: Uint8Array
	try {
		nonce = b64urlDecode(parts[1]!)
		ciphertext = b64urlDecode(parts[2]!)
	} catch {
		throw new DecryptionError('Malformed envelope encoding')
	}
	if (nonce.length !== s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) {
		throw new DecryptionError('Malformed envelope nonce')
	}
	try {
		return s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, utf8Encode(aad), nonce, key)
	} catch {
		throw new DecryptionError()
	}
}

export function sealJson(key: Uint8Array, value: unknown, aad: string): string {
	return seal(key, utf8Encode(JSON.stringify(value)), aad)
}

export function openJson<T = unknown>(key: Uint8Array, envelope: string, aad: string): T {
	return JSON.parse(utf8Decode(open(key, envelope, aad))) as T
}

export const ENVELOPE_RE = /^1\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]+$/
