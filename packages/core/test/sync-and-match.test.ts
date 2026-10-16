import { describe, expect, it } from 'vitest'
import {
	type ItemRecord,
	type SyncResponse,
	VaultCache,
	matchLogins,
	matchUrl,
	newItem,
	registrableDomain,
} from '../src/index.ts'

describe('URL matching', () => {
	it('ranks origin, host and registrable-domain matches', () => {
		expect(matchUrl('https://github.com/login', 'https://github.com/settings')).toEqual({ kind: 'origin', insecure: false })
		expect(matchUrl('github.com', 'https://github.com/')).toEqual({ kind: 'origin', insecure: false })
		expect(matchUrl('https://www.github.com', 'https://github.com')).toEqual({ kind: 'host', insecure: false })
		expect(matchUrl('https://example.com:8443', 'https://example.com')).toEqual({ kind: 'host', insecure: false })
		expect(matchUrl('https://accounts.example.co.uk', 'https://shop.example.co.uk')).toEqual({ kind: 'domain', insecure: false })
	})

	it('flags https logins on http pages', () => {
		expect(matchUrl('https://example.com', 'http://example.com/login')).toEqual({ kind: 'origin', insecure: true })
		expect(matchUrl('http://example.com', 'https://example.com')).toEqual({ kind: 'host', insecure: false })
	})

	it('never matches unrelated sites, public suffixes, IPs loosely, or non-web URLs', () => {
		expect(matchUrl('https://example.com', 'https://example.com.evil.test')).toBeNull()
		expect(matchUrl('https://alice.github.io', 'https://mallory.github.io')).toBeNull()
		expect(matchUrl('https://a.example.co.uk', 'https://b.other.co.uk')).toBeNull()
		expect(matchUrl('https://192.168.1.1', 'https://192.168.1.2')).toBeNull()
		expect(matchUrl('http://192.168.1.1:8080', 'http://192.168.1.1')).toEqual({ kind: 'host', insecure: false })
		expect(matchUrl('androidapp://com.example', 'https://example.com')).toBeNull()
		expect(matchUrl('https://example.com', 'chrome://settings')).toBeNull()
		expect(matchUrl('', 'https://example.com')).toBeNull()
	})

	it('computes registrable domains', () => {
		expect(registrableDomain('https://login.example.co.uk/x')).toBe('example.co.uk')
		expect(registrableDomain('alice.github.io')).toBe('alice.github.io')
		expect(registrableDomain('localhost')).toBe('localhost')
	})

	it('sorts matching logins best first and skips other item types', () => {
		const entries = [
			{ item: newItem('login', { title: 'Zeta', urls: ['https://accounts.example.com'] }) },
			{ item: newItem('login', { title: 'Beta', urls: ['https://other.test', 'https://login.example.com'] }) },
			{ item: newItem('login', { title: 'Alpha', urls: ['https://example.com'] }) },
			{ item: newItem('note', { title: 'Note' }) },
			{ item: newItem('login', { title: 'Unrelated', urls: ['https://example.org'] }) },
		]
		const matches = matchLogins(entries, 'https://login.example.com/signin')
		expect(matches.map((m) => [m.entry.item.title, m.kind])).toEqual([
			['Beta', 'origin'],
			['Alpha', 'domain'],
			['Zeta', 'domain'],
		])
	})
})

describe('VaultCache', () => {
	const record = (id: string, revision: number, extra: Partial<ItemRecord> = {}): ItemRecord => ({
		id, wrappedKey: 'k', data: 'd', revision, createdAt: 1, updatedAt: 1, deletedAt: null, ...extra,
	})
	const sync = (partial: Partial<SyncResponse>): SyncResponse => ({ revision: 0, items: [], folders: [], attachments: [], tombstones: [], ...partial })

	it('applies syncs, tombstones and attachment cleanup', () => {
		const cache = new VaultCache()
		const first = cache.applySync(sync({
			revision: 3,
			items: [record('a', 1), record('b', 2)],
			attachments: [{ id: 'att', itemId: 'b', wrappedKey: 'k', meta: 'm', size: 10, revision: 3, createdAt: 1 }],
		}))
		expect(first.updatedItems).toEqual(['a', 'b'])
		expect(cache.revision).toBe(3)

		const second = cache.applySync(sync({ revision: 5, items: [record('a', 5, { deletedAt: 9 })], tombstones: [{ type: 'item', id: 'b', revision: 4 }] }))
		expect(second).toEqual({ updatedItems: ['a'], removedItems: ['b'] })
		expect(cache.items.get('a')?.deletedAt).toBe(9)
		expect(cache.items.has('b')).toBe(false)
		expect(cache.attachments.size).toBe(0)
	})

	it('only advances the revision on gap-free local writes', () => {
		const cache = new VaultCache()
		cache.applySync(sync({ revision: 5 }))
		cache.putItem(record('a', 6))
		expect(cache.revision).toBe(6)
		// Another device wrote revision 7 meanwhile: don't skip it.
		cache.putItem(record('b', 8))
		expect(cache.revision).toBe(6)
		expect(cache.items.has('b')).toBe(true)
	})

	it('round-trips through JSON', () => {
		const cache = new VaultCache()
		cache.applySync(sync({ revision: 2, items: [record('a', 2)], folders: [{ id: 'f', wrappedKey: 'k', data: 'd', revision: 1, createdAt: 1, updatedAt: 1 }] }))
		const copy = VaultCache.fromJSON(JSON.parse(JSON.stringify(cache.toJSON())))
		expect(copy.revision).toBe(2)
		expect(copy.items.get('a')).toEqual(record('a', 2))
		expect(copy.folders.has('f')).toBe(true)
		expect(VaultCache.fromJSON(null).revision).toBe(0)
	})
})
