import { z } from 'zod'

/**
 * Vault item payloads. Everything here is encrypted client-side; the server only
 * sees an opaque envelope. Schemas are "loose" so fields written by a newer client
 * survive a round-trip through an older one.
 */

export const ITEM_TYPES = ['login', 'note', 'card', 'identity'] as const
export type ItemType = typeof ITEM_TYPES[number]

const text = () => z.string().default('')
const timestamp = () => z.string().default(() => new Date().toISOString())

export const CustomFieldSchema = z.looseObject({
	label: text(),
	type: z.enum(['text', 'hidden']).catch('text').default('text'),
	value: text(),
})
export type CustomField = z.infer<typeof CustomFieldSchema>

/**
 * A WebAuthn credential (passkey) for a website. Stored so the browser extension /
 * desktop client can act as the authenticator. `privateKey` is PKCS#8, base64url.
 */
export const PasskeySchema = z.looseObject({
	credentialId: z.string(),
	rpId: z.string(),
	rpName: text(),
	userHandle: text(),
	userName: text(),
	userDisplayName: text(),
	privateKey: z.string(),
	/** COSE algorithm: -7 = ES256, -8 = EdDSA, -257 = RS256. */
	algorithm: z.number().int().default(-7),
	signCount: z.number().int().nonnegative().default(0),
	discoverable: z.boolean().default(true),
	createdAt: timestamp(),
})
export type Passkey = z.infer<typeof PasskeySchema>

export const PasswordHistoryEntrySchema = z.looseObject({
	password: z.string(),
	changedAt: z.string(),
})

const common = {
	schemaVersion: z.number().int().default(1),
	title: text(),
	folderId: z.string().nullable().default(null),
	favorite: z.boolean().default(false),
	notes: text(),
	customFields: z.array(CustomFieldSchema).default([]),
	createdAt: timestamp(),
	updatedAt: timestamp(),
}

export const LoginSchema = z.looseObject({
	...common,
	type: z.literal('login'),
	username: text(),
	password: text(),
	urls: z.array(z.string()).default([]),
	/** otpauth:// URI (or bare base32 secret). */
	totp: text(),
	passwordChangedAt: z.string().nullable().default(null),
	passwordHistory: z.array(PasswordHistoryEntrySchema).default([]),
	passkeys: z.array(PasskeySchema).default([]),
})

export const NoteSchema = z.looseObject({
	...common,
	type: z.literal('note'),
})

export const CardSchema = z.looseObject({
	...common,
	type: z.literal('card'),
	cardholderName: text(),
	number: text(),
	/** "01".."12" or "" */
	expMonth: text(),
	/** Four-digit year or "" */
	expYear: text(),
	cvc: text(),
	pin: text(),
	zip: text(),
})

export const IdentitySchema = z.looseObject({
	...common,
	type: z.literal('identity'),
	firstName: text(),
	middleName: text(),
	lastName: text(),
	email: text(),
	phone: text(),
	company: text(),
	address1: text(),
	address2: text(),
	city: text(),
	state: text(),
	zip: text(),
	country: text(),
	birthday: text(),
})

export const ItemSchema = z.discriminatedUnion('type', [LoginSchema, NoteSchema, CardSchema, IdentitySchema])

export type LoginItem = z.infer<typeof LoginSchema>
export type NoteItem = z.infer<typeof NoteSchema>
export type CardItem = z.infer<typeof CardSchema>
export type IdentityItem = z.infer<typeof IdentitySchema>
export type Item = z.infer<typeof ItemSchema>
export type ItemOfType<T extends ItemType> = Extract<Item, { type: T }>
export type ItemInput = z.input<typeof ItemSchema>

export const FolderSchema = z.looseObject({
	schemaVersion: z.number().int().default(1),
	name: text(),
})
export type Folder = z.infer<typeof FolderSchema>

export function parseItem(value: unknown): Item {
	return ItemSchema.parse(value)
}

export function newItem<T extends ItemType>(type: T, fields: Partial<Omit<ItemOfType<T>, 'type'>> = {}): ItemOfType<T> {
	const now = new Date().toISOString()
	return ItemSchema.parse({ createdAt: now, updatedAt: now, ...fields, type }) as ItemOfType<T>
}

/** Apply an edit, maintaining updatedAt and the login password history. */
export function updateItem<T extends Item>(previous: T, next: T): T {
	const now = new Date().toISOString()
	const updated = { ...next, updatedAt: now }
	if (previous.type === 'login' && updated.type === 'login' && previous.password !== updated.password) {
		updated.passwordChangedAt = now
		if (previous.password) {
			updated.passwordHistory = [
				{ password: previous.password, changedAt: now },
				...previous.passwordHistory,
			].slice(0, 20)
		}
	}
	return parseItem(updated) as T
}

/* ---------- display helpers ---------- */

export function normaliseUrl(url: string): string {
	const trimmed = url.trim()
	if (!trimmed) {
		return ''
	}
	return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function hostnameOf(url: string): string {
	try {
		return new URL(normaliseUrl(url)).hostname.replace(/^www\./, '')
	} catch {
		return url.trim()
	}
}

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'diners' | 'jcb' | 'unionpay' | 'maestro' | 'unknown'

export function cardBrand(number: string): CardBrand {
	const n = number.replace(/\D/g, '')
	if (/^4/.test(n)) return 'visa'
	if (/^(5[1-5]|2(2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720))/.test(n)) return 'mastercard'
	if (/^3[47]/.test(n)) return 'amex'
	if (/^(6011|65|64[4-9])/.test(n)) return 'discover'
	if (/^3(0[0-5]|[68])/.test(n)) return 'diners'
	if (/^35(2[89]|[3-8])/.test(n)) return 'jcb'
	if (/^62/.test(n)) return 'unionpay'
	if (/^(5[06-9]|6\d)/.test(n)) return 'maestro'
	return 'unknown'
}

export function luhnValid(number: string): boolean {
	const digits = number.replace(/\D/g, '')
	if (digits.length < 12) {
		return false
	}
	let sum = 0
	for (let i = 0; i < digits.length; i++) {
		let d = Number(digits[digits.length - 1 - i])
		if (i % 2 === 1) {
			d *= 2
			if (d > 9) d -= 9
		}
		sum += d
	}
	return sum % 10 === 0
}

export function maskCardNumber(number: string): string {
	const digits = number.replace(/\D/g, '')
	return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : ''
}

export function formatCardNumber(number: string): string {
	const digits = number.replace(/\D/g, '')
	return cardBrand(digits) === 'amex'
		? digits.replace(/^(\d{0,4})(\d{0,6})(\d{0,5}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' '))
		: digits.replace(/(\d{4})(?=\d)/g, '$1 ')
}

export function fullName(item: Pick<IdentityItem, 'firstName' | 'middleName' | 'lastName'>): string {
	return [item.firstName, item.middleName, item.lastName].filter(Boolean).join(' ')
}

export function itemSubtitle(item: Item): string {
	switch (item.type) {
	case 'login':
		return item.username || (item.urls[0] ? hostnameOf(item.urls[0]) : '') || (item.passkeys.length ? 'Passkey' : '')
	case 'card':
		return [maskCardNumber(item.number), item.expMonth && item.expYear ? `${item.expMonth}/${item.expYear.slice(-2)}` : ''].filter(Boolean).join(' · ')
	case 'identity':
		return fullName(item) || item.email
	case 'note':
		return item.notes.split('\n').find((l) => l.trim())?.trim().slice(0, 80) ?? ''
	}
}

/** Lower-cased haystack for the in-memory search box. */
export function itemSearchText(item: Item): string {
	const parts: string[] = [item.title, item.notes, ...item.customFields.filter((f) => f.type === 'text').map((f) => `${f.label} ${f.value}`)]
	switch (item.type) {
	case 'login':
		parts.push(item.username, ...item.urls, ...item.passkeys.map((p) => `${p.rpId} ${p.userName}`))
		break
	case 'card':
		parts.push(item.cardholderName, cardBrand(item.number), item.number.replace(/\D/g, '').slice(-4))
		break
	case 'identity':
		parts.push(fullName(item), item.email, item.phone, item.company, item.city, item.country)
		break
	}
	return parts.join(' ').toLowerCase()
}

export function itemDisplayTitle(item: Item): string {
	if (item.title.trim()) {
		return item.title
	}
	if (item.type === 'login' && item.urls[0]) {
		return hostnameOf(item.urls[0])
	}
	return 'Untitled'
}
