import { type TotpParams, parseTotp } from '../tools/totp.ts'
import { type Item, itemDisplayTitle } from './items.ts'

/** A login's one-time code, as the authenticator-style "2FA codes" list shows it. */
export interface CodeEntry {
	/** The login's item id. */
	id: string
	/** The login's title, else the code's issuer, else the website, else the account. */
	name: string
	/** The login's username, else the code's account name; empty when it would repeat the name. */
	account: string
	totp: TotpParams
}

/**
 * Every login with a valid one-time code, sorted by name, then account. With
 * `query`, only the codes whose name or account contains every word of it.
 * `items` are the vault's items outside the trash.
 */
export function codeEntries(items: Iterable<{ id: string, item: Item }>, query = ''): CodeEntry[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
	const result: CodeEntry[] = []
	for (const { id, item } of items) {
		if (item.type !== 'login' || !item.totp.trim()) {
			continue
		}
		let totp: TotpParams
		try {
			totp = parseTotp(item.totp)
		} catch {
			continue
		}
		const account = item.username.trim() || totp.account.trim()
		const name = item.title.trim() || totp.issuer.trim() || (item.urls.length ? itemDisplayTitle(item) : account) || itemDisplayTitle(item)
		const entry = { id, name, account: account === name ? '' : account, totp }
		const text = `${entry.name} ${entry.account}`.toLowerCase()
		if (terms.every((term) => text.includes(term))) {
			result.push(entry)
		}
	}
	return result.sort((a, b) => compareText(a.name, b.name) || compareText(a.account, b.account) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Case-insensitive, like the vault lists. */
function compareText(a: string, b: string): number {
	return a.localeCompare(b, undefined, { sensitivity: 'base' })
}
