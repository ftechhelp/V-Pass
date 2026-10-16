import Papa from 'papaparse'
import { type CustomField, type Item, type ItemType, newItem } from '../model/items.ts'

/**
 * NordPass CSV export → V-Pass items. Runs entirely on the client.
 *
 * Known NordPass columns (matched by header name, order does not matter):
 *   name, url, additional_urls, username, password, note, cardholdername, cardnumber,
 *   cvc, pin, expirydate, zipcode, folder, full_name, phone_number, email, address1,
 *   address2, city, country, state, type, custom_fields
 *
 * `type` is one of password | note | credit_card | identity | folder. Older exports
 * without a `type` column are handled by inferring the type from the filled columns.
 * Any column we don't recognise is preserved as a custom field so nothing is lost.
 */

export const NORDPASS_COLUMNS = [
	'name', 'url', 'additional_urls', 'username', 'password', 'note', 'cardholdername', 'cardnumber',
	'cvc', 'pin', 'expirydate', 'zipcode', 'folder', 'full_name', 'phone_number', 'email', 'address1',
	'address2', 'city', 'country', 'state', 'type', 'custom_fields',
] as const

const KNOWN = new Set<string>(NORDPASS_COLUMNS)
const TOTP_COLUMNS = new Set(['totp', 'otp', 'otpauth', '2fa', 'one_time_password', 'authenticator'])

export interface ImportedEntry {
	item: Item
	/** Folder name from the export; resolved to a folder id by the caller. */
	folderName: string | null
	/** 1-based data row number in the CSV (header excluded). */
	row: number
}

export interface SkippedRow {
	row: number
	name: string
	reason: string
}

export interface ImportReport {
	format: 'nordpass-csv'
	entries: ImportedEntry[]
	/** Unique folder names (first-seen casing), including empty folders. */
	folders: string[]
	skipped: SkippedRow[]
	unknownColumns: string[]
	counts: Record<ItemType, number>
}

type Row = Record<string, string | undefined>

export function looksLikeNordPassCsv(text: string): boolean {
	const header = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0]?.toLowerCase() ?? ''
	const cols = header.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
	return cols.includes('name') && cols.includes('url') && cols.includes('cardholdername')
}

export function parseNordPassCsv(text: string): ImportReport {
	const parsed = Papa.parse<Row>(text.replace(/^﻿/, ''), {
		header: true,
		skipEmptyLines: 'greedy',
		transformHeader: (h) => h.trim().toLowerCase(),
	})
	const headers = parsed.meta.fields ?? []
	if (!headers.includes('name')) {
		throw new Error('This does not look like a NordPass CSV export (missing "name" column).')
	}
	const unknownColumns = headers.filter((h) => h && !KNOWN.has(h))

	const report: ImportReport = {
		format: 'nordpass-csv',
		entries: [],
		folders: [],
		skipped: [],
		unknownColumns,
		counts: { login: 0, note: 0, card: 0, identity: 0 },
	}
	const folderKeys = new Map<string, string>()
	const addFolder = (name: string): string | null => {
		const trimmed = name.trim()
		if (!trimmed) {
			return null
		}
		const key = trimmed.toLowerCase()
		if (!folderKeys.has(key)) {
			folderKeys.set(key, trimmed)
			report.folders.push(trimmed)
		}
		return folderKeys.get(key)!
	}

	parsed.data.forEach((row, index) => {
		const rowNumber = index + 1
		const get = (col: string) => (row[col] ?? '').trim()
		const raw = (col: string) => row[col] ?? ''
		const type = get('type').toLowerCase() || inferType(row)

		if (type === 'folder') {
			if (!addFolder(get('name') || get('folder'))) {
				report.skipped.push({ row: rowNumber, name: '', reason: 'Folder row without a name' })
			}
			return
		}

		const folderName = addFolder(get('folder'))
		const customFields = parseCustomFields(raw('custom_fields'))
		let notes = raw('note').replace(/\r\n/g, '\n')
		if (customFields.unparsed) {
			notes = [notes, `Custom fields (could not be parsed):\n${customFields.unparsed}`].filter(Boolean).join('\n\n')
		}
		let totp = ''
		for (const col of unknownColumns) {
			const value = raw(col).trim()
			if (!value) continue
			if (TOTP_COLUMNS.has(col) && !totp) {
				totp = value
			} else {
				customFields.fields.push({ label: col, type: 'text', value })
			}
		}
		const base = { title: get('name'), notes, customFields: customFields.fields }

		let item: Item
		switch (type) {
		case 'password':
		case 'login': {
			const urls = dedupe([get('url'), ...parseJsonStringArray(raw('additional_urls'))])
			item = newItem('login', { ...base, username: get('username'), password: raw('password'), urls, totp })
			break
		}
		case 'note':
		case 'secure_note':
			item = newItem('note', base)
			break
		case 'credit_card':
		case 'card': {
			const { month, year } = parseExpiry(get('expirydate'))
			item = newItem('card', {
				...base,
				cardholderName: get('cardholdername'),
				number: get('cardnumber').replace(/[\s-]/g, ''),
				cvc: get('cvc'),
				pin: get('pin'),
				zip: get('zipcode'),
				expMonth: month,
				expYear: year,
			})
			break
		}
		case 'identity':
		case 'personal_info': {
			const name = splitFullName(get('full_name'))
			item = newItem('identity', {
				...base,
				...name,
				email: get('email'),
				phone: get('phone_number'),
				address1: get('address1'),
				address2: get('address2'),
				city: get('city'),
				state: get('state'),
				zip: get('zipcode'),
				country: get('country'),
			})
			break
		}
		default:
			report.skipped.push({ row: rowNumber, name: get('name'), reason: type ? `Unsupported item type "${type}"` : 'Empty row' })
			return
		}

		if (!item.title) {
			item.title = defaultTitle(item)
		}
		report.entries.push({ item, folderName, row: rowNumber })
		report.counts[item.type]++
	})

	for (const error of parsed.errors) {
		// Papa reports recoverable issues (e.g. a field count mismatch) here; surface them.
		const row = (error.row ?? -1) + 1
		if (!report.skipped.some((s) => s.row === row)) {
			report.skipped.push({ row, name: '', reason: `CSV problem: ${error.message}` })
		}
	}
	return report
}

function inferType(row: Row): string {
	const has = (col: string) => Boolean(row[col]?.trim())
	if (has('cardnumber') || has('cardholdername') || has('cvc')) return 'credit_card'
	if (has('full_name') || has('address1') || has('phone_number') || has('city')) return 'identity'
	if (has('url') || has('username') || has('password')) return 'password'
	if (has('name') && has('note')) return 'note'
	if (!has('name') && has('folder')) return 'folder'
	return has('name') ? 'note' : ''
}

function parseCustomFields(value: string): { fields: CustomField[], unparsed: string } {
	const trimmed = value.trim()
	if (!trimmed) {
		return { fields: [], unparsed: '' }
	}
	try {
		const parsed: unknown = JSON.parse(trimmed)
		if (!Array.isArray(parsed)) {
			throw new Error('not an array')
		}
		const fields = parsed
			.filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
			.map((f) => ({
				label: String(f.label ?? f.name ?? ''),
				type: f.type === 'hidden' ? 'hidden' as const : 'text' as const,
				value: String(f.value ?? ''),
			}))
			.filter((f) => f.label || f.value)
		return { fields, unparsed: '' }
	} catch {
		return { fields: [], unparsed: trimmed }
	}
}

function parseJsonStringArray(value: string): string[] {
	const trimmed = value.trim()
	if (!trimmed) {
		return []
	}
	try {
		const parsed: unknown = JSON.parse(trimmed)
		return Array.isArray(parsed) ? parsed.map((v) => String(v).trim()).filter(Boolean) : []
	} catch {
		// Not JSON: accept a comma/newline separated list.
		return trimmed.split(/[\n,]/).map((v) => v.trim()).filter(Boolean)
	}
}

/** Accepts MM/YY, MM/YYYY, MM-YY, MM.YYYY, YYYY-MM and MMYY. */
export function parseExpiry(value: string): { month: string, year: string } {
	const v = value.trim()
	let m: RegExpMatchArray | null
	let month = ''
	let year = ''
	if ((m = v.match(/^(\d{4})[-/.](\d{1,2})$/))) {
		year = m[1]!
		month = m[2]!
	} else if ((m = v.match(/^(\d{1,2})\s*[-/.]\s*(\d{2}|\d{4})$/))) {
		month = m[1]!
		year = m[2]!
	} else if ((m = v.match(/^(\d{2})(\d{2})$/))) {
		month = m[1]!
		year = m[2]!
	} else {
		return { month: '', year: '' }
	}
	const monthNum = Number(month)
	if (monthNum < 1 || monthNum > 12) {
		return { month: '', year: '' }
	}
	if (year.length === 2) {
		year = `20${year}`
	}
	return { month: String(monthNum).padStart(2, '0'), year }
}

function splitFullName(name: string): { firstName: string, middleName: string, lastName: string } {
	const parts = name.split(/\s+/).filter(Boolean)
	if (parts.length <= 1) {
		return { firstName: parts[0] ?? '', middleName: '', lastName: '' }
	}
	return {
		firstName: parts[0]!,
		middleName: parts.slice(1, -1).join(' '),
		lastName: parts[parts.length - 1]!,
	}
}

function dedupe(values: string[]): string[] {
	return [...new Set(values.map((v) => v.trim()).filter(Boolean))]
}

function defaultTitle(item: Item): string {
	switch (item.type) {
	case 'login':
		return item.urls[0]?.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] || item.username || 'Untitled login'
	case 'card':
		return item.cardholderName || 'Credit card'
	case 'identity':
		return [item.firstName, item.lastName].filter(Boolean).join(' ') || item.email || 'Personal info'
	case 'note':
		return 'Untitled note'
	}
}
