/**
 * Have I Been Pwned "Pwned Passwords" range API with k-anonymity:
 * only the first 5 hex characters of the password's SHA-1 leave the device,
 * and matching against the returned suffixes happens locally.
 */

export type RangeFetcher = (prefix: string) => Promise<string>

export async function sha1Hex(text: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** Parse a range response ("SUFFIX:COUNT" per line). Padding rows with count 0 are dropped. */
export function parseRange(body: string): Map<string, number> {
	const out = new Map<string, number>()
	for (const line of body.split(/\r?\n/)) {
		const [suffix, count] = line.trim().split(':')
		const n = Number(count)
		if (suffix && n > 0) {
			out.set(suffix.toUpperCase(), n)
		}
	}
	return out
}

/** How many times the password appears in known breaches (0 = not found). */
export async function pwnedCount(password: string, fetchRange: RangeFetcher): Promise<number> {
	const hash = await sha1Hex(password)
	const range = parseRange(await fetchRange(hash.slice(0, 5)))
	return range.get(hash.slice(5)) ?? 0
}
