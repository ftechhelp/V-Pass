import { type Item, fullName, hostnameOf } from '../model/items.ts'

/**
 * A fingerprint that two "same" items share, used to flag likely duplicates
 * when importing into a vault that already has data.
 */
export function itemFingerprint(item: Item): string {
	const norm = (s: string) => s.trim().toLowerCase()
	switch (item.type) {
	case 'login':
		return ['login', norm(item.urls[0] ? hostnameOf(item.urls[0]) : item.title), norm(item.username)].join('|')
	case 'card':
		return ['card', item.number.replace(/\D/g, '')].join('|')
	case 'identity':
		return ['identity', norm(item.title), norm(fullName(item)), norm(item.email)].join('|')
	case 'note':
		return ['note', norm(item.title), norm(item.notes)].join('|')
	}
}

/** Indices of `incoming` items that already exist in `existing`. */
export function findDuplicates(incoming: Item[], existing: Iterable<Item>): Set<number> {
	const known = new Set<string>()
	for (const item of existing) {
		known.add(itemFingerprint(item))
	}
	const duplicates = new Set<number>()
	incoming.forEach((item, i) => {
		if (known.has(itemFingerprint(item))) {
			duplicates.add(i)
		}
	})
	return duplicates
}
