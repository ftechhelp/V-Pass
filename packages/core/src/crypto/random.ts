/** Cryptographically secure random bytes (works in browsers, workers, extensions and Node). */
export function randomBytes(length: number): Uint8Array {
	const out = new Uint8Array(length)
	for (let i = 0; i < length; i += 65536) {
		globalThis.crypto.getRandomValues(out.subarray(i, Math.min(i + 65536, length)))
	}
	return out
}

/** Uniform random integer in [0, maxExclusive) using rejection sampling (no modulo bias). */
export function randomInt(maxExclusive: number): number {
	if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 2 ** 32) {
		throw new RangeError('maxExclusive must be an integer in (0, 2^32]')
	}
	const limit = 2 ** 32 - (2 ** 32 % maxExclusive)
	const buf = new Uint32Array(1)
	for (;;) {
		globalThis.crypto.getRandomValues(buf)
		if (buf[0]! < limit) {
			return buf[0]! % maxExclusive
		}
	}
}

/** RFC 4122 v4 UUID. Avoids crypto.randomUUID, which is missing in some extension/worker contexts. */
export function uuid(): string {
	const b = randomBytes(16)
	b[6] = (b[6]! & 0x0f) | 0x40
	b[8] = (b[8]! & 0x3f) | 0x80
	const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
