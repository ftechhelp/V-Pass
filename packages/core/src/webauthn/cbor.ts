/**
 * Minimal CBOR encoder (RFC 8949): just enough for COSE public keys and WebAuthn
 * attestation objects. Maps keep insertion order, so callers insert keys in
 * CTAP2 canonical order (shorter encodings first) themselves.
 */
export type CborKey = number | string
export type CborValue = number | string | boolean | null | Uint8Array | CborValue[] | Map<CborKey, CborValue>

export function cborEncode(value: CborValue): Uint8Array {
	const out: number[] = []
	write(out, value)
	return Uint8Array.from(out)
}

function header(out: number[], major: number, length: number): void {
	if (!Number.isSafeInteger(length) || length < 0) {
		throw new RangeError(`CBOR length out of range: ${length}`)
	}
	const type = major << 5
	if (length < 24) {
		out.push(type | length)
	} else if (length < 0x100) {
		out.push(type | 24, length)
	} else if (length < 0x10000) {
		out.push(type | 25, length >> 8, length & 0xff)
	} else if (length < 0x100000000) {
		out.push(type | 26, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff)
	} else {
		const high = Math.floor(length / 0x100000000)
		const low = length >>> 0
		out.push(type | 27, (high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff,
			(low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff)
	}
}

function write(out: number[], value: CborValue): void {
	if (typeof value === 'number') {
		if (!Number.isInteger(value)) {
			throw new TypeError('CBOR floats are not supported')
		}
		if (value >= 0) {
			header(out, 0, value)
		} else {
			header(out, 1, -1 - value)
		}
	} else if (typeof value === 'string') {
		const bytes = new TextEncoder().encode(value)
		header(out, 3, bytes.length)
		for (const b of bytes) out.push(b)
	} else if (typeof value === 'boolean') {
		out.push(value ? 0xf5 : 0xf4)
	} else if (value === null) {
		out.push(0xf6)
	} else if (value instanceof Uint8Array) {
		header(out, 2, value.length)
		for (const b of value) out.push(b)
	} else if (Array.isArray(value)) {
		header(out, 4, value.length)
		value.forEach((v) => write(out, v))
	} else {
		header(out, 5, value.size)
		for (const [k, v] of value) {
			write(out, k)
			write(out, v)
		}
	}
}
