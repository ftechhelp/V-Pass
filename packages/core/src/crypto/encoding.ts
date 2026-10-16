import { EncodingError } from './errors.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function utf8Encode(text: string): Uint8Array {
	return encoder.encode(text)
}

export function utf8Decode(bytes: Uint8Array): string {
	return decoder.decode(bytes)
}

/** Base64url without padding (RFC 4648 §5). Used for every binary value on the wire. */
export function b64urlEncode(bytes: Uint8Array): string {
	let binary = ''
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(text: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
		throw new EncodingError('Invalid base64url string')
	}
	const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)
	const binary = atob(b64)
	const out = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		out[i] = binary.charCodeAt(i)
	}
	return out
}

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32, uppercase, no padding. */
export function base32Encode(bytes: Uint8Array): string {
	let bits = 0
	let value = 0
	let out = ''
	for (const byte of bytes) {
		value = (value << 8) | byte
		bits += 8
		while (bits >= 5) {
			out += B32_ALPHABET[(value >>> (bits - 5)) & 31]
			bits -= 5
		}
	}
	if (bits > 0) {
		out += B32_ALPHABET[(value << (5 - bits)) & 31]
	}
	return out
}

/** Lenient base32 decode: ignores case, whitespace, dashes and trailing padding. */
export function base32Decode(text: string): Uint8Array {
	const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')
	const out: number[] = []
	let bits = 0
	let value = 0
	for (const char of clean) {
		const index = B32_ALPHABET.indexOf(char)
		if (index === -1) {
			throw new EncodingError(`Invalid base32 character "${char}"`)
		}
		value = (value << 5) | index
		bits += 5
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 0xff)
			bits -= 8
		}
	}
	return new Uint8Array(out)
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
	let offset = 0
	for (const part of parts) {
		out.set(part, offset)
		offset += part.length
	}
	return out
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) {
		return false
	}
	let diff = 0
	for (let i = 0; i < a.length; i++) {
		diff |= a[i]! ^ b[i]!
	}
	return diff === 0
}
