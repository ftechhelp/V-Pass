import { describe, expect, it } from 'vitest'
import {
	AuthenticatorImport,
	InvalidAuthenticatorExportError,
	base32Decode,
	isGoogleAuthenticatorExport,
	newItem,
	newLoginForAuthenticatorEntry,
	parseAuthenticatorExport,
	parseTotp,
	planAuthenticatorImport,
} from '../src/index.ts'
import { migrationLink } from './helpers/google-authenticator.ts'

const KEY = 'JBSWY3DPEHPK3PXP'
const KEY2 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const KEY3 = 'MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U'

describe('Google Authenticator export codes', () => {
	it('reads the format\'s well-known sample link', () => {
		// The example from the open-source decoders' documentation (one TOTP account, no batch fields).
		const result = parseAuthenticatorExport('otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8SGEV4YW1wbGU6YWxpY2VAZ29vZ2xlLmNvbRoHRXhhbXBsZTAC')
		expect(result.format).toBe('google-authenticator')
		expect(result.entries).toEqual([{
			totp: `otpauth://totp/Example%3Aalice%40google.com?secret=${KEY}&issuer=Example`,
			issuer: 'Example',
			account: 'alice@google.com',
		}])
		expect(result.batches).toEqual([{ id: 0, index: 0, size: 1 }])
	})

	it('reads algorithms, digits and names, and skips codes V-Pass can\'t use', () => {
		const link = migrationLink([
			{ secret: base32Decode(KEY2), name: 'octocat', issuer: 'GitHub', algorithm: 2, digits: 2 },
			{ secret: base32Decode(KEY3), name: 'Svc:bob@example.com' },
			{ secret: base32Decode(KEY), name: 'counter', issuer: 'Old bank', type: 1, counter: 7 },
			{ secret: base32Decode(KEY), name: 'md5', issuer: 'Weird', algorithm: 4 },
			{ secret: new Uint8Array([1, 2]), name: 'short', issuer: 'Tiny' },
		], { size: 3, index: 1, id: -42 })
		const result = parseAuthenticatorExport(link)
		expect(result.entries.map((e) => [e.issuer, e.account])).toEqual([['GitHub', 'octocat'], ['Svc', 'bob@example.com']])
		const github = parseTotp(result.entries[0]!.totp)
		expect(github).toMatchObject({ algorithm: 'SHA256', digits: 8, period: 30, issuer: 'GitHub', account: 'octocat' })
		expect(parseTotp(result.entries[1]!.totp).algorithm).toBe('SHA1')
		expect(result.skipped).toEqual([
			{ issuer: 'Old bank', account: 'counter', reason: 'Counter-based (HOTP) codes aren\'t supported' },
			{ issuer: 'Weird', account: 'md5', reason: 'MD5 codes aren\'t supported' },
			{ issuer: 'Tiny', account: 'short', reason: 'Authenticator key is too short' },
		])
		expect(result.batches).toEqual([{ id: -42, index: 1, size: 3 }])
	})

	it('accepts unencoded base64 (whose "+" URL parsing turns into a space), and strips the issuer from the name', () => {
		// Find a key whose link has a "+" in its base64.
		let secret = new Uint8Array(10)
		let raw = ''
		for (let i = 0; !raw.includes('+'); i++) {
			secret = Uint8Array.from({ length: 10 }, (_, j) => (i * 7 + j * 31) & 0xff)
			raw = decodeURIComponent(migrationLink([{ secret, name: 'Acme:me', issuer: 'Acme' }]).split('data=')[1]!)
		}
		const result = parseAuthenticatorExport(`otpauth-migration://offline?data=${raw}`)
		expect(result.entries[0]).toMatchObject({ issuer: 'Acme', account: 'me' })
		expect(parseTotp(result.entries[0]!.totp).secret).toEqual(secret)
	})

	it('rejects damaged codes and other text', () => {
		expect(() => parseAuthenticatorExport('otpauth-migration://offline?data=CjEKCkhlbGxv')).toThrow(InvalidAuthenticatorExportError)
		expect(() => parseAuthenticatorExport('otpauth-migration://offline?data=%%%')).toThrow(InvalidAuthenticatorExportError)
		expect(() => parseAuthenticatorExport('https://example.com/')).toThrow(InvalidAuthenticatorExportError)
		expect(() => parseAuthenticatorExport('{"hello":"world"}')).toThrow(InvalidAuthenticatorExportError)
		expect(() => parseAuthenticatorExport('{oops')).toThrow(InvalidAuthenticatorExportError)
	})

	it('recognises export links', () => {
		expect(isGoogleAuthenticatorExport(' otpauth-migration://offline?data=x')).toBe(true)
		expect(isGoogleAuthenticatorExport('otpauth://totp/x?secret=JBSWY3DP')).toBe(false)
	})
})

describe('other apps\' exports', () => {
	it('reads lists of otpauth:// links (Ente Auth and others)', () => {
		const text = [
			`otpauth://totp/GitHub:octocat?secret=${KEY}&issuer=GitHub&codeDisplay=%7B%22pinned%22%3Afalse%7D`,
			'',
			`"otpauth://totp/Example:alice@example.com?secret=${KEY2}&algorithm=SHA512&digits=8&period=60"`,
			`otpauth://hotp/Old:counter?secret=${KEY3}&counter=1`,
			'otpauth://totp/Broken?secret=!!!',
		].join('\n')
		const result = parseAuthenticatorExport(text)
		expect(result.format).toBe('otpauth')
		expect(result.entries.map((e) => [e.issuer, e.account])).toEqual([['GitHub', 'octocat'], ['Example', 'alice@example.com']])
		expect(parseTotp(result.entries[1]!.totp)).toMatchObject({ algorithm: 'SHA512', digits: 8, period: 60 })
		expect(result.skipped).toEqual([
			{ issuer: 'Old', account: 'counter', reason: 'Counter-based (HOTP) codes aren\'t supported' },
			{ issuer: '', account: 'Broken', reason: 'Not a valid authenticator key or otpauth:// link' },
		])
	})

	it('reads an unencrypted Aegis export and refuses an encrypted one', () => {
		const aegis = {
			version: 1,
			header: { slots: null, params: null },
			db: {
				version: 3,
				entries: [
					{ type: 'totp', uuid: 'a', name: 'alice@example.com', issuer: 'Example', info: { secret: KEY, algo: 'SHA256', digits: 7, period: 45 } },
					{ type: 'hotp', name: 'counter', issuer: 'Old', info: { secret: KEY, algo: 'SHA1', digits: 6, counter: 3 } },
					{ type: 'steam', name: 'gamer', issuer: 'Steam', info: { secret: KEY, algo: 'SHA1', digits: 5, period: 30 } },
					{ type: 'totp', name: 'bad', issuer: 'Odd', info: { secret: KEY, algo: 'SHA1', digits: 9, period: 30 } },
				],
			},
		}
		const result = parseAuthenticatorExport(JSON.stringify(aegis))
		expect(result.format).toBe('aegis')
		expect(result.entries).toHaveLength(1)
		expect(parseTotp(result.entries[0]!.totp)).toMatchObject({ issuer: 'Example', account: 'alice@example.com', algorithm: 'SHA256', digits: 7, period: 45 })
		expect(result.skipped.map((s) => s.reason)).toEqual([
			'Counter-based (HOTP) codes aren\'t supported',
			'Steam Guard codes aren\'t supported',
			'Unsupported digits or period',
		])
		expect(() => parseAuthenticatorExport(JSON.stringify({ ...aegis, db: 'b64ciphertext' }))).toThrow(/Aegis export is encrypted/)
	})

	it('reads an unencrypted 2FAS export and refuses an encrypted one', () => {
		const twofas = {
			services: [
				{ name: 'GitHub', secret: KEY, otp: { account: 'octocat', issuer: 'GitHub', digits: 6, period: 30, algorithm: 'SHA1', tokenType: 'TOTP' } },
				{ name: 'Fallback name', secret: KEY2, otp: { label: 'me@example.com', digits: '8', period: '60' } },
				{ name: 'Counter', secret: KEY3, otp: { tokenType: 'HOTP', counter: 4 } },
			],
			groups: [],
			schemaVersion: 4,
		}
		const result = parseAuthenticatorExport(JSON.stringify(twofas))
		expect(result.format).toBe('2fas')
		expect(result.entries.map((e) => [e.issuer, e.account])).toEqual([['GitHub', 'octocat'], ['Fallback name', 'me@example.com']])
		expect(parseTotp(result.entries[1]!.totp)).toMatchObject({ digits: 8, period: 60 })
		expect(result.skipped).toEqual([{ issuer: 'Counter', account: '', reason: 'Counter-based (HOTP) codes aren\'t supported' }])
		expect(() => parseAuthenticatorExport(JSON.stringify({ services: [], servicesEncrypted: 'abc:def' }))).toThrow(/2FAS export is encrypted/)
	})

	it('reads a Bitwarden export and refuses an encrypted one', () => {
		const bitwarden = {
			encrypted: false,
			items: [
				{ name: 'GitHub', type: 1, login: { username: 'octocat', totp: `otpauth://totp/GitHub:octocat?secret=${KEY}&issuer=GitHub` } },
				{ name: 'Bank', type: 1, login: { username: 'me@example.com', totp: KEY2.toLowerCase() } },
				{ name: 'Steam', type: 1, login: { username: 'gamer', totp: 'steam://ABCDEFGH' } },
				{ name: 'No code', type: 1, login: { username: 'x', password: 'y' } },
				{ name: 'A note', type: 2 },
			],
		}
		const result = parseAuthenticatorExport(JSON.stringify(bitwarden))
		expect(result.format).toBe('bitwarden')
		expect(result.entries.map((e) => [e.issuer, e.account])).toEqual([['GitHub', 'octocat'], ['Bank', 'me@example.com']])
		expect(parseTotp(result.entries[1]!.totp).secret).toEqual(base32Decode(KEY2))
		expect(result.skipped).toEqual([{ issuer: 'Steam', account: 'gamer', reason: 'Steam Guard codes aren\'t supported' }])
		expect(() => parseAuthenticatorExport('{"encrypted":true,"encKeyValidation_DO_NOT_EDIT":"x","data":"y","items":[]}')).toThrow(/Bitwarden export is encrypted/)
	})
})

describe('collecting codes from several scans', () => {
	it('counts each QR code and each code once, and follows Google Authenticator\'s batches', () => {
		const batch = (index: number, accounts: Parameters<typeof migrationLink>[0]) => migrationLink(accounts, { size: 3, index, id: 99 })
		const first = batch(0, [{ secret: base32Decode(KEY), name: 'a', issuer: 'A' }, { secret: base32Decode(KEY2), name: 'b', issuer: 'B' }])
		const collected = new AuthenticatorImport()
		expect(collected.progress).toBeNull()
		expect(collected.add(first)).toEqual({ added: 2, skipped: 0, repeated: false })
		expect(collected.progress).toEqual({ scanned: 1, total: 3 })
		expect(collected.add(` ${first}\n`)).toEqual({ added: 0, skipped: 0, repeated: true })
		// The same code from a file is not added twice.
		expect(collected.add(`otpauth://totp/Other:label?secret=${KEY}`)).toEqual({ added: 0, skipped: 0, repeated: false })
		expect(collected.add(batch(2, [{ secret: base32Decode(KEY3), name: 'c', issuer: 'C', type: 1 }]))).toEqual({ added: 0, skipped: 1, repeated: false })
		expect(collected.progress).toEqual({ scanned: 2, total: 3 })
		expect(collected.entries.map((e) => e.issuer)).toEqual(['A', 'B'])
		expect(collected.skipped.map((s) => s.issuer)).toEqual(['C'])
		expect(() => collected.add('not a code')).toThrow(InvalidAuthenticatorExportError)
	})
})

describe('planning where each code goes', () => {
	const login = (id: string, fields: Parameters<typeof newItem<'login'>>[1]) => ({ id, item: newItem('login', fields) })
	const entry = (issuer: string, account: string, key: string) => ({ totp: `otpauth://totp/x?secret=${key}`, issuer, account })

	it('finds existing codes, the same account, and the only login for a service', () => {
		const items = [
			login('github', { title: 'GitHub', username: 'octocat', urls: ['https://github.com'], totp: `otpauth://totp/GitHub:octocat?secret=${KEY.toLowerCase()}` }),
			login('google-personal', { title: 'Gmail', username: 'me@gmail.com', urls: ['https://accounts.google.com'] }),
			login('google-work', { title: 'Work Google', username: 'me@work.example', urls: ['https://mail.google.com'] }),
			login('bank', { title: 'My Bank', username: 'customer-1', urls: ['https://online.mybank.co.uk/login'], totp: KEY3 }),
			login('acme', { title: 'ACME Corp', username: '' }),
			{ id: 'note', item: newItem('note', { title: 'GitHub' }) },
		]
		const plan = planAuthenticatorImport([
			entry('GitHub', 'octocat@example.com', KEY), // same key as the GitHub login
			entry('Google', 'me@work.example', KEY2), // same service and username
			entry('Google', 'someone@else.example', 'MZXW6YTBOI'), // two Google logins, neither matches: new
			entry('mybank', 'customer-1', 'MZXW6YTBOJAA'), // same username, but the login has another code
			entry('Acme-Corp', 'admin', 'MZXW6YTBOJBB'), // the only ACME login, no code yet
			entry('', 'nobody', 'MZXW6YTBOJCC'), // no issuer: always new
		], items)
		expect(plan.map((r) => [r.action, r.itemId, r.selected])).toEqual([
			['exists', 'github', false],
			['add', 'google-work', true],
			['new', null, true],
			['replace', 'bank', false],
			['add', 'acme', true],
			['new', null, true],
		])
	})

	it('puts at most one code into each login, preferring exact usernames', () => {
		const items = [login('google', { title: 'Google', username: 'b@gmail.com' })]
		// "a" comes first but only "b" is this login's username.
		const plan = planAuthenticatorImport([entry('Google', 'a@gmail.com', KEY), entry('Google', 'b@gmail.com', KEY2)], items)
		expect(plan.map((r) => [r.action, r.itemId])).toEqual([['new', null], ['add', 'google']])
	})

	it('uses the only login for a service only without a code and with a username that fits', () => {
		const withCode = [login('x', { title: 'X', username: 'me', totp: KEY3 })]
		expect(planAuthenticatorImport([entry('X', 'me@x.example', KEY)], withCode)[0]!.action).toBe('new')
		const noCode = [login('x', { title: 'X', username: 'me@x.example' })]
		expect(planAuthenticatorImport([entry('X', 'other@x.example', KEY)], noCode)[0]!.action).toBe('new')
		expect(planAuthenticatorImport([entry('X', 'me', KEY)], noCode)[0]!.action).toBe('add')
		expect(planAuthenticatorImport([entry('X', '', KEY)], noCode)[0]!.action).toBe('add')
	})

	it('names new logins after the issuer and account', () => {
		const item = newLoginForAuthenticatorEntry(entry('Example', 'alice', KEY))
		expect(item).toMatchObject({ type: 'login', title: 'Example', username: 'alice', totp: `otpauth://totp/x?secret=${KEY}` })
		expect(newLoginForAuthenticatorEntry(entry('', 'alice@example.com', KEY)).title).toBe('alice@example.com')
		expect(newLoginForAuthenticatorEntry(entry('', '', KEY)).title).toBe('One-time code')
	})
})
