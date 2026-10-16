import { getDomain } from 'tldts'
import { type Item, normaliseUrl } from '../model/items.ts'

/**
 * Which saved logins belong to the page the user is on. Used by the browser
 * extension's autofill and popup, and by any client that suggests logins.
 */

/** How closely a saved URL matches the page, best first. */
export type UrlMatchKind = 'origin' | 'host' | 'domain'

export interface UrlMatch {
	kind: UrlMatchKind
	/** The saved URL is https but the page is plain http: fill only after confirmation. */
	insecure: boolean
}

const RANK: Record<UrlMatchKind, number> = { origin: 0, host: 1, domain: 2 }

function parseWebUrl(url: string): URL | null {
	try {
		const parsed = new URL(normaliseUrl(url))
		return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : null
	} catch {
		return null
	}
}

const stripWww = (host: string) => host.replace(/^www\./, '')

/** eTLD+1 (`login.example.co.uk` → `example.co.uk`); hosts without one (IPs, localhost) map to themselves. */
export function registrableDomain(urlOrHost: string): string {
	const host = parseWebUrl(urlOrHost)?.hostname ?? urlOrHost.trim().toLowerCase()
	return getDomain(host, { allowPrivateDomains: true }) ?? host
}

/** How `savedUrl` matches `pageUrl`, or null. Only http(s) URLs ever match. */
export function matchUrl(savedUrl: string, pageUrl: string): UrlMatch | null {
	const saved = parseWebUrl(savedUrl)
	const page = parseWebUrl(pageUrl)
	if (!saved || !page) {
		return null
	}
	const insecure = saved.protocol === 'https:' && page.protocol === 'http:'
	if (saved.origin === page.origin || (insecure && saved.host === page.host)) {
		return { kind: 'origin', insecure }
	}
	if (stripWww(saved.hostname) === stripWww(page.hostname)) {
		return { kind: 'host', insecure }
	}
	const domain = registrableDomain(page.hostname)
	// Hosts without a registrable domain (IP addresses, localhost) only match exactly.
	if (domain !== page.hostname && registrableDomain(saved.hostname) === domain) {
		return { kind: 'domain', insecure }
	}
	return null
}

export interface LoginMatch<T> extends UrlMatch {
	entry: T
}

/** Logins whose URLs match the page, best match first, then by title. */
export function matchLogins<T extends { item: Item }>(entries: Iterable<T>, pageUrl: string): LoginMatch<T>[] {
	const matches: LoginMatch<T>[] = []
	for (const entry of entries) {
		if (entry.item.type !== 'login') {
			continue
		}
		let best: UrlMatch | null = null
		for (const url of entry.item.urls) {
			const m = matchUrl(url, pageUrl)
			if (m && (!best || RANK[m.kind] < RANK[best.kind] || (RANK[m.kind] === RANK[best.kind] && best.insecure && !m.insecure))) {
				best = m
			}
		}
		if (best) {
			matches.push({ ...best, entry })
		}
	}
	return matches.sort((a, b) => RANK[a.kind] - RANK[b.kind]
		|| Number(a.insecure) - Number(b.insecure)
		|| a.entry.item.title.localeCompare(b.entry.item.title, undefined, { sensitivity: 'base' }))
}
