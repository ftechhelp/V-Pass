import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import {
	DecryptionError,
	cardBrand,
	createBackup,
	exportNordPassCsv,
	findDuplicates,
	initCrypto,
	isBackupFile,
	itemSubtitle,
	looksLikeNordPassCsv,
	luhnValid,
	newItem,
	openBackup,
	parseExpiry,
	parseNordPassCsv,
	updateItem,
} from '../src/index.ts'
import type { CardItem, IdentityItem, LoginItem, NoteItem } from '../src/index.ts'

const fixture = readFileSync(new URL('./fixtures/nordpass-export.csv', import.meta.url), 'utf8')

describe('NordPass CSV import', () => {
	const report = parseNordPassCsv(fixture)
	const byTitle = (title: string) => report.entries.find((e) => e.item.title === title)!

	it('detects the format', () => {
		expect(looksLikeNordPassCsv(fixture)).toBe(true)
		expect(looksLikeNordPassCsv('﻿' + fixture)).toBe(true)
		expect(looksLikeNordPassCsv('url,username,password\n')).toBe(false)
	})

	it('counts every supported type and reports skipped rows', () => {
		expect(report.counts).toEqual({ login: 3, note: 1, card: 1, identity: 1 })
		expect(report.entries).toHaveLength(6)
		expect(report.skipped).toEqual([{ row: 8, name: 'Something', reason: 'Unsupported item type "wallet_address"' }])
		expect(report.unknownColumns).toEqual([])
	})

	it('collects folders case-insensitively, including empty ones', () => {
		expect(report.folders).toEqual(['Work', 'personal', 'Finance', 'Empty Folder'])
		expect(byTitle('Wi-Fi').folderName).toBe('personal')
		expect(byTitle('GitHub').folderName).toBe('Work')
	})

	it('maps logins with additional URLs and typed custom fields', () => {
		const { item } = byTitle('GitHub') as { item: LoginItem }
		expect(item.type).toBe('login')
		expect(item.username).toBe('alice@example.com')
		expect(item.password).toBe('c0rrect-H0rse!')
		expect(item.urls).toEqual(['https://github.com/login', 'https://gist.github.com'])
		expect(item.customFields).toEqual([
			{ label: 'Recovery codes', type: 'hidden', value: '1111-2222' },
			{ label: 'Team', type: 'text', value: 'Core' },
		])
	})

	it('keeps quotes/commas in passwords, multi-line notes and derives missing titles', () => {
		const entry = report.entries.find((e) => e.item.type === 'login' && e.item.username === 'bob')!
		const item = entry.item as LoginItem
		expect(item.password).toBe('p,a"ss')
		expect(item.notes).toBe('line1\nline2')
		expect(item.title).toBe('example.org')
	})

	it('preserves unicode in secure notes', () => {
		const { item } = byTitle('Wi-Fi') as { item: NoteItem }
		expect(item.type).toBe('note')
		expect(item.notes).toBe('SSID: Home\nKey: ünïcødé 🔑')
	})

	it('maps credit cards', () => {
		const { item } = byTitle('Visa Gold') as { item: CardItem }
		expect(item).toMatchObject({ type: 'card', cardholderName: 'Alice Example', number: '4111111111111111', cvc: '123', pin: '4321', expMonth: '07', expYear: '2029', zip: '90210' })
		expect(cardBrand(item.number)).toBe('visa')
		expect(itemSubtitle(item)).toBe('•••• 1111 · 07/29')
	})

	it('maps personal info and splits the full name', () => {
		const { item } = byTitle('Me') as { item: IdentityItem }
		expect(item).toMatchObject({
			type: 'identity', firstName: 'Alice', middleName: 'Marie', lastName: 'Example', phone: '+1 555 0100',
			email: 'alice@example.com', address1: '1 Main St', address2: 'Apt 2', city: 'Springfield', state: 'IL', zip: '62701', country: 'US', notes: 'Primary identity',
		})
	})

	it('keeps unparseable custom_fields in the notes instead of dropping them', () => {
		const { item } = byTitle('Bank') as { item: LoginItem }
		expect(item.customFields).toEqual([])
		expect(item.notes).toContain('not json')
	})

	it('preserves unknown columns and maps a totp column', () => {
		const csv = 'name,url,username,password,type,totp,tags\nSite,https://x.test,me,pw,password,otpauth://totp/x?secret=GEZDGNBV,red\n'
		const r = parseNordPassCsv(csv)
		const item = r.entries[0]!.item as LoginItem
		expect(r.unknownColumns).toEqual(['totp', 'tags'])
		expect(item.totp).toBe('otpauth://totp/x?secret=GEZDGNBV')
		expect(item.customFields).toEqual([{ label: 'tags', type: 'text', value: 'red' }])
	})

	it('infers types for old exports without a type column', () => {
		const csv = 'name,url,username,password,note,cardholdername,cardnumber,cvc,expirydate,zipcode,folder,full_name,phone_number,email,address1,address2,city,country,state\n'
			+ 'Mail,https://mail.test,me,pw,,,,,,,,,,,,,,,\n'
			+ 'Card,,,,,Me,5555555555554444,111,1/2030,,,,,,,,,,\n'
			+ 'Notes,,,,hello,,,,,,,,,,,,,,\n'
		const r = parseNordPassCsv(csv)
		expect(r.entries.map((e) => e.item.type)).toEqual(['login', 'card', 'note'])
		expect((r.entries[1]!.item as CardItem).expMonth).toBe('01')
	})

	it('rejects files that are not NordPass exports', () => {
		expect(() => parseNordPassCsv('foo,bar\n1,2\n')).toThrow(/NordPass/)
	})

	it('parses expiry formats', () => {
		expect(parseExpiry('07/29')).toEqual({ month: '07', year: '2029' })
		expect(parseExpiry('7/2031')).toEqual({ month: '07', year: '2031' })
		expect(parseExpiry('2030-12')).toEqual({ month: '12', year: '2030' })
		expect(parseExpiry('1229')).toEqual({ month: '12', year: '2029' })
		expect(parseExpiry('13/29')).toEqual({ month: '', year: '' })
		expect(parseExpiry('')).toEqual({ month: '', year: '' })
	})
})

describe('duplicates', () => {
	it('matches logins by host + username', () => {
		const existing = [newItem('login', { urls: ['https://www.github.com/'], username: 'Alice@Example.com' })]
		const incoming = [
			newItem('login', { urls: ['github.com/login'], username: 'alice@example.com' }),
			newItem('login', { urls: ['github.com'], username: 'bob' }),
		]
		expect([...findDuplicates(incoming, existing)]).toEqual([0])
	})
})

describe('NordPass CSV export', () => {
	it('round-trips through the importer', () => {
		const original = parseNordPassCsv(fixture)
		const folderOf = new Map(original.entries.map((e) => [e.item, e.folderName]))
		const items = original.entries.map((e) => ({ ...e.item, folderId: e.folderName }))
		const csv = exportNordPassCsv(items, (id) => id ?? '')
		const again = parseNordPassCsv(csv)
		expect(again.counts).toEqual(original.counts)
		again.entries.forEach((e, i) => {
			const before = original.entries[i]!
			expect(e.folderName ?? null).toBe(folderOf.get(before.item) ?? null)
			const { createdAt: _a, updatedAt: _b, ...rest } = e.item
			const { createdAt: _c, updatedAt: _d, ...expected } = before.item
			expect(rest).toEqual(expected)
		})
	})
})

describe('encrypted backup', () => {
	beforeAll(async () => {
		await initCrypto()
	})

	it('round-trips and rejects a wrong password', () => {
		const payload = {
			folders: [{ id: 'f1', name: 'Work' }],
			items: [{ id: 'i1', item: newItem('login', { title: 'x', password: 'y', folderId: 'f1' }) }],
		}
		const file = createBackup(payload, 'backup-pw')
		expect(isBackupFile(file)).toBe(true)
		expect(file).not.toContain('"y"')
		expect(openBackup(file, 'backup-pw')).toEqual(payload)
		expect(() => openBackup(file, 'nope')).toThrow(DecryptionError)
	})
})

describe('item helpers', () => {
	it('tracks password history on change', () => {
		const before = newItem('login', { password: 'one' })
		const after = updateItem(before, { ...before, password: 'two' })
		expect(after.passwordHistory[0]?.password).toBe('one')
		expect(after.passwordChangedAt).not.toBeNull()
		const unchanged = updateItem(after, { ...after, title: 'renamed' })
		expect(unchanged.passwordHistory).toHaveLength(1)
	})

	it('validates card numbers', () => {
		expect(luhnValid('4111 1111 1111 1111')).toBe(true)
		expect(luhnValid('4111 1111 1111 1112')).toBe(false)
		expect(cardBrand('378282246310005')).toBe('amex')
		expect(cardBrand('5555555555554444')).toBe('mastercard')
		expect(cardBrand('2223003122003222')).toBe('mastercard')
	})
})
