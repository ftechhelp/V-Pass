import QRCode from 'qrcode'
import { beforeAll, describe, expect, it } from 'vitest'
import {
	ExportQrCodeError,
	InvalidTotpError,
	NoQrCodeError,
	analyzePasswords,
	buildOtpauthUri,
	checkBreaches,
	checkStrength,
	generatePassphrase,
	generatePassword,
	hotp,
	loadStrengthEstimator,
	newItem,
	parseRange,
	parseTotp,
	pwnedCount,
	readQrText,
	readTotpQr,
	sha1Hex,
	totpCode,
	utf8Encode,
} from '../src/index.ts'
import { EFF_LARGE_WORDLIST } from '../src/tools/eff-wordlist.ts'

describe('password generator', () => {
	it('honours length and includes every selected class', () => {
		for (let i = 0; i < 200; i++) {
			const pw = generatePassword({ length: 12, lowercase: true, uppercase: true, digits: true, symbols: true, avoidAmbiguous: false })
			expect(pw).toHaveLength(12)
			expect(pw).toMatch(/[a-z]/)
			expect(pw).toMatch(/[A-Z]/)
			expect(pw).toMatch(/\d/)
			expect(pw).toMatch(/[^a-zA-Z0-9]/)
		}
	})

	it('only uses selected classes and skips ambiguous characters', () => {
		for (let i = 0; i < 200; i++) {
			expect(generatePassword({ length: 30, lowercase: false, uppercase: false, digits: true, symbols: false, avoidAmbiguous: false })).toMatch(/^\d{30}$/)
			expect(generatePassword({ length: 40, lowercase: true, uppercase: true, digits: true, symbols: false, avoidAmbiguous: true })).not.toMatch(/[Il1O0o]/)
		}
	})

	it('clamps length and rejects empty selections', () => {
		expect(generatePassword({ length: 1, lowercase: true, uppercase: true, digits: true, symbols: true, avoidAmbiguous: false })).toHaveLength(4)
		expect(generatePassword({ length: 999, lowercase: true, uppercase: false, digits: false, symbols: false, avoidAmbiguous: false })).toHaveLength(128)
		expect(() => generatePassword({ length: 10, lowercase: false, uppercase: false, digits: false, symbols: false, avoidAmbiguous: false })).toThrow()
	})

	it('builds passphrases from the EFF list', () => {
		expect(EFF_LARGE_WORDLIST).toHaveLength(7776)
		expect(EFF_LARGE_WORDLIST[0]).toBe('abacus')
		const phrase = generatePassphrase({ words: 6, separator: '.', capitalize: false, includeNumber: false })
		const parts = phrase.split('.')
		expect(parts).toHaveLength(6)
		for (const word of parts) expect(EFF_LARGE_WORDLIST).toContain(word)
		const withNumber = generatePassphrase({ words: 4, separator: ' ', capitalize: true, includeNumber: true })
		expect(withNumber).toMatch(/\d/)
		expect(withNumber.split(' ').every((w) => /^[A-Z]/.test(w))).toBe(true)
	})
})

describe('TOTP (RFC 6238 appendix B vectors)', () => {
	const sha1Secret = utf8Encode('12345678901234567890')
	const sha256Secret = utf8Encode('12345678901234567890123456789012')
	const sha512Secret = utf8Encode('1234567890123456789012345678901234567890123456789012345678901234')
	const vectors: [number, string, string, string][] = [
		[59, '94287082', '46119246', '90693936'],
		[1111111109, '07081804', '68084774', '25091201'],
		[1111111111, '14050471', '67062674', '99943326'],
		[1234567890, '89005924', '91819424', '93441116'],
		[2000000000, '69279037', '90698825', '38618901'],
		[20000000000, '65353130', '77737706', '47863826'],
	]
	it.each(vectors)('t=%i', async (t, sha1, sha256, sha512) => {
		const counter = Math.floor(t / 30)
		expect(await hotp(sha1Secret, counter, 'SHA1', 8)).toBe(sha1)
		expect(await hotp(sha256Secret, counter, 'SHA256', 8)).toBe(sha256)
		expect(await hotp(sha512Secret, counter, 'SHA512', 8)).toBe(sha512)
	})

	it('parses otpauth URIs and bare secrets', async () => {
		const p = parseTotp('otpauth://totp/ACME%20Co:alice@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=ACME%20Co&period=30&digits=8')
		expect(p.issuer).toBe('ACME Co')
		expect(p.account).toBe('alice@example.com')
		expect(p.digits).toBe(8)
		expect((await totpCode(p, 59_000)).code).toBe('94287082')
		expect((await totpCode(p, 59_000)).remaining).toBe(1)
		const bare = parseTotp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')
		expect(bare.secret).toEqual(p.secret)
		expect(parseTotp(buildOtpauthUri(p))).toMatchObject({ issuer: 'ACME Co', account: 'alice@example.com', digits: 8 })
	})

	it('rejects junk and HOTP links', () => {
		expect(() => parseTotp('not a secret!')).toThrow(InvalidTotpError)
		expect(() => parseTotp('otpauth://hotp/x?secret=GEZDGNBV&counter=1')).toThrow(InvalidTotpError)
		expect(() => parseTotp('otpauth://totp/x')).toThrow(InvalidTotpError)
	})
})

/** Render a QR code as RGBA pixels (4 px per module, 4-module quiet zone), like a screenshot of one. */
function qrImage(text: string, inverted = false) {
	const { modules } = QRCode.create(text)
	const scale = 4
	const size = (modules.size + 8) * scale
	const data = new Uint8ClampedArray(size * size * 4)
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const row = Math.floor(y / scale) - 4
			const col = Math.floor(x / scale) - 4
			const inside = row >= 0 && col >= 0 && row < modules.size && col < modules.size
			const dark = (inside && modules.get(row, col) === 1) !== inverted
			data.fill(dark ? 0 : 255, (y * size + x) * 4, (y * size + x) * 4 + 3)
			data[(y * size + x) * 4 + 3] = 255
		}
	}
	return { data, width: size, height: size }
}

describe('reading authenticator QR codes', () => {
	const uri = 'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example'

	it('returns the otpauth link as encoded', async () => {
		expect(await readTotpQr(qrImage(uri))).toBe(uri)
	})

	it('reads light-on-dark codes too', async () => {
		expect(await readTotpQr(qrImage(uri, true))).toBe(uri)
	})

	it('rejects QR codes that are not authenticator keys', async () => {
		await expect(readTotpQr(qrImage('https://example.com/'))).rejects.toThrow(InvalidTotpError)
		await expect(readTotpQr(qrImage('otpauth://hotp/x?secret=GEZDGNBV&counter=1'))).rejects.toThrow(InvalidTotpError)
	})

	it('tells a Google Authenticator export apart, and reads it as plain text', async () => {
		const link = 'otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8SGEV4YW1wbGU6YWxpY2VAZ29vZ2xlLmNvbRoHRXhhbXBsZTAC'
		await expect(readTotpQr(qrImage(link))).rejects.toThrow(ExportQrCodeError)
		expect(await readQrText(qrImage(link))).toBe(link)
	})

	it('reports an image without a QR code', async () => {
		const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 }
		await expect(readTotpQr(blank)).rejects.toThrow(NoQrCodeError)
	})
})

describe('HIBP k-anonymity', () => {
	it('hashes with SHA-1 and only sends the 5-char prefix', async () => {
		expect(await sha1Hex('password')).toBe('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8')
		const seen: string[] = []
		const count = await pwnedCount('password', async (prefix) => {
			seen.push(prefix)
			return '1E4C9B93F3F0682250B6CF8331B7EE68FD8:9659365\r\n0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n'
		})
		expect(seen).toEqual(['5BAA6'])
		expect(count).toBe(9659365)
	})

	it('ignores padding rows', () => {
		expect(parseRange('AAA:0\nBBB:3').size).toBe(1)
	})

	it('dedupes passwords and prefixes when scanning a vault', async () => {
		const entries = [
			{ id: 'a', item: newItem('login', { password: 'password' }) },
			{ id: 'b', item: newItem('login', { password: 'password' }) },
			{ id: 'c', item: newItem('login', { password: 'unique-and-long-PW-42!' }) },
		]
		let calls = 0
		const result = await checkBreaches(entries, async (prefix) => {
			calls++
			return prefix === '5BAA6' ? '1E4C9B93F3F0682250B6CF8331B7EE68FD8:42' : ''
		})
		expect(calls).toBe(2)
		expect(Object.fromEntries(result)).toEqual({ a: 42, b: 42 })
	})
})

describe('password health', () => {
	it('flags weak, reused and old passwords', () => {
		const old = new Date('2020-01-01T00:00:00Z').toISOString()
		const entries = [
			{ id: 'weak', item: newItem('login', { password: 'abc' }) },
			{ id: 'r1', item: newItem('login', { password: 'Shared-Pa55word-xyz' }) },
			{ id: 'r2', item: newItem('login', { password: 'Shared-Pa55word-xyz' }) },
			{ id: 'old', item: newItem('login', { password: 'Ancient-But-Strong-1!', createdAt: old }) },
			{ id: 'none', item: newItem('login', { username: 'passkey-only' }) },
		]
		const report = analyzePasswords(entries, { strength: (pw) => (pw.length < 8 ? 0 : 4), now: new Date('2026-10-01') })
		expect(report.total).toBe(4)
		expect(report.weak).toEqual(['weak'])
		expect(report.reused).toEqual([['r1', 'r2']])
		expect(report.old).toEqual(['old'])
		expect(report.score).toBe(25)
	})
})

describe('strength estimator', () => {
	beforeAll(async () => {
		await loadStrengthEstimator()
	})

	it('scores obvious passwords low and random ones high', () => {
		expect(checkStrength('password').score).toBe(0)
		expect(checkStrength(generatePassword()).score).toBe(4)
		expect(checkStrength('alice2024', ['alice']).score).toBeLessThan(3)
	})
})
