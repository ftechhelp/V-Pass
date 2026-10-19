import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'
import {
	AAD,
	KDF_CONTEXT,
	ItemSchema,
	b64urlDecode,
	b64urlEncode,
	base32Encode,
	cardBrand,
	createCredential,
	createVaultKeys,
	deriveMasterKey,
	deriveSubkey,
	encryptAttachment,
	encryptFolder,
	encryptItem,
	formatCardNumber,
	getAssertion,
	initCrypto,
	itemDisplayTitle,
	itemSearchText,
	itemSubtitle,
	luhnValid,
	maskCardNumber,
	matchUrl,
	newKdfParams,
	parseTotp,
	registrableDomain,
	seal,
	totpCode,
	uuid,
} from '../src/index.ts'
import { EFF_LARGE_WORDLIST } from '../src/tools/eff-wordlist.ts'

/**
 * Writes the fixtures that prove the Swift port (ios/VPassKit) is byte-compatible
 * with this package: `npm run vectors:ios`. Everything is produced by the real
 * TypeScript code; the Swift tests must open, reproduce or verify each value.
 * Ciphertexts use random nonces, so every run produces a different (equally
 * valid) file.
 */
const here = dirname(fileURLToPath(import.meta.url))
const kit = resolve(here, '../../../ios/VPassKit')
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const utf8 = (text: string) => new TextEncoder().encode(text)

const stamp = '2026-01-02T03:04:05.678Z'

/** Items as core's schema produces them, with unknown fields that must survive Swift. */
function sampleItems() {
	const common = { createdAt: stamp, updatedAt: stamp }
	return [
		{
			...common,
			type: 'login',
			title: 'GitHub',
			username: 'octocat',
			password: 'hunter2 ünïcödé 🔑',
			urls: ['https://github.com/login', 'github.com'],
			totp: 'otpauth://totp/GitHub:octocat?secret=JBSWY3DPEHPK3PXP&issuer=GitHub',
			notes: 'line one\nline "two"\t\\ backslash',
			favorite: true,
			customFields: [{ label: 'PIN', type: 'hidden', value: '1234', futureFlag: true }, { label: 'Note', type: 'bogus', value: 'x' }],
			passwordHistory: [{ password: 'old', changedAt: stamp }],
			passkeys: [{
				credentialId: 'AAECAwQFBgcICQoLDA0ODw',
				rpId: 'github.com',
				userHandle: 'dXNlcg',
				userName: 'octocat',
				privateKey: 'AA',
				createdAt: stamp,
			}],
			futureField: { nested: [1, 2.5, null, 'x'] },
			schemaVersion: 1,
		},
		{ ...common, type: 'note', title: '', notes: '\n  First real line  \nsecond' },
		{ ...common, type: 'card', title: 'Amex', cardholderName: 'A. Person', number: '3782 822463 10005', expMonth: '07', expYear: '2031', cvc: '1234' },
		{ ...common, type: 'identity', title: 'Me', firstName: 'Ada', middleName: '', lastName: 'Lovelace', email: 'ada@example.com', city: 'London', country: 'UK' },
		{ ...common, type: 'login', title: '', urls: ['https://www.example.co.uk/x'], folderId: null },
	]
}

test('write iOS vectors', async () => {
	await initCrypto()

	// Argon2id with the minimum parameters the validator accepts, and a password that NFKC changes.
	const kdf = { ...newKdfParams(2, 32 * 1024 * 1024), salt: b64urlEncode(Uint8Array.from({ length: 16 }, (_, i) => i)) }
	const password = 'Correct horse ﬁ Ａ battery Å'
	const masterKey = deriveMasterKey(password, kdf)
	const kek = deriveSubkey(masterKey, KDF_CONTEXT.keyEncryptionKey)

	const vault = createVaultKeys(password, kdf)
	const vaultKey = vault.vaultKey

	const items = sampleItems().map((input) => {
		const id = uuid()
		const enc = encryptItem(vaultKey, id, ItemSchema.parse(input))
		return {
			id,
			record: { id, wrappedKey: enc.wrappedKey, data: enc.data, revision: 7, createdAt: 1700000000, updatedAt: 1700000001, deletedAt: null },
			itemKey: hex(enc.key),
			parsed: JSON.parse(JSON.stringify(ItemSchema.parse(input))),
			title: itemDisplayTitle(ItemSchema.parse(input)),
			subtitle: itemSubtitle(ItemSchema.parse(input)),
			searchText: itemSearchText(ItemSchema.parse(input)),
		}
	})

	const folderId = uuid()
	const folder = encryptFolder(vaultKey, folderId, { schemaVersion: 1, name: 'Work 💼' })

	// More than one 64 KiB chunk, so the secretstream chunking is exercised.
	const content = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 7) & 0xff)
	const itemKey = b64urlDecode(b64urlEncode(Uint8Array.from({ length: 32 }, (_, i) => 255 - i)))
	const attachmentId = uuid()
	const attachment = encryptAttachment(itemKey, attachmentId, content, { name: 'scan.pdf', mimeType: 'application/pdf', size: content.length })

	const passkeys = []
	for (const alg of [-7, -257]) {
		const created = await createCredential({
			rp: { id: 'webauthn.io', name: 'WebAuthn.io' },
			user: { id: b64urlEncode(utf8('user-1')), name: 'alice', displayName: 'Alice' },
			challenge: b64urlEncode(utf8('challenge')),
			pubKeyCredParams: [{ type: 'public-key', alg }],
		}, { origin: 'https://webauthn.io' })
		const assertion = await getAssertion({ challenge: b64urlEncode(utf8('c2')), rpId: 'webauthn.io' }, created.passkey, { origin: 'https://webauthn.io' })
		passkeys.push({
			passkey: created.passkey,
			publicKey: created.response.response.publicKey,
			// A get() for the same RP produces this authenticatorData (signatures differ per run).
			assertionAuthData: hex(b64urlDecode(assertion.response.authenticatorData)),
			registrationAuthDataPrefix: hex(b64urlDecode(created.response.response.authenticatorData).subarray(0, 37)),
		})
	}

	const key = Uint8Array.from({ length: 32 }, (_, i) => i * 3)
	const envelopes = [
		{ aad: 'vpass:item:abc', plaintext: '' },
		{ aad: AAD.item('6f1c0e8e-1111-4222-8333-444455556666'), plaintext: '{"a":"ü"}' },
		{ aad: 'x'.repeat(300), plaintext: 'y'.repeat(1000) },
	].map((e) => ({ ...e, key: hex(key), envelope: seal(key, utf8(e.plaintext), e.aad) }))

	const urls: [string, string][] = [
		['https://github.com/login', 'https://github.com/settings'],
		['github.com', 'https://github.com/'],
		['https://www.github.com', 'https://github.com'],
		['https://example.com:8443', 'https://example.com'],
		['https://example.com:443', 'https://example.com'],
		['https://accounts.example.co.uk', 'https://shop.example.co.uk'],
		['https://accounts.example.com', 'https://example.com'],
		['https://example.com', 'https://login.example.com'],
		['https://example.com', 'http://example.com/login'],
		['http://example.com', 'https://example.com'],
		['https://example.com', 'https://example.com.evil.test'],
		['https://alice.github.io', 'https://mallory.github.io'],
		['https://a.example.co.uk', 'https://b.other.co.uk'],
		['https://192.168.1.1', 'https://192.168.1.2'],
		['http://192.168.1.1:8080', 'http://192.168.1.1'],
		['http://localhost:3000', 'http://localhost:3000/x'],
		['androidapp://com.example', 'https://example.com'],
		['https://example.com', 'chrome://settings'],
		['', 'https://example.com'],
		['HTTPS://GitHub.COM/Login', 'https://github.com'],
		['https://foo.blogspot.com', 'https://bar.blogspot.com'],
		['https://a.b.c.kobe.jp', 'https://x.b.c.kobe.jp'],
		['https://www.city.kobe.jp', 'https://other.city.kobe.jp'],
	]

	const totpInputs = [
		'JBSWY3DPEHPK3PXP',
		'jbsw y3dp ehpk 3pxp',
		'otpauth://totp/ACME%20Co:john@example.com?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=ACME+Co&algorithm=SHA1&digits=6&period=30',
		'otpauth://totp/user?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA&algorithm=SHA256&digits=8&period=60',
		'otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA&algorithm=SHA512&digits=8',
	]
	const times = [59_000, 1_111_111_109_000, 1_234_567_890_000, 2_000_000_000_000, 20_000_000_000_000]
	const totp = []
	for (const input of totpInputs) {
		const params = parseTotp(input)
		for (const now of times) {
			const code = await totpCode(params, now)
			totp.push({ input, now, code: code.code, remaining: code.remaining, issuer: params.issuer, account: params.account })
		}
	}

	const cards = ['4111 1111 1111 1111', '5555555555554444', '2221000000000009', '378282246310005', '6011111111111117', '30569309025904', '3530111333300000', '6200000000000005', '5018000000000009', '1234'].map((number) => ({
		number, brand: cardBrand(number), luhn: luhnValid(number), masked: maskCardNumber(number), formatted: formatCardNumber(number),
	}))

	const vectors = {
		generatedBy: 'packages/core/scripts/ios-vectors.ts',
		encoding: [new Uint8Array([]), new Uint8Array([0xff]), new Uint8Array([0xfb, 0xff, 0xbf]), utf8('any carnal pleas')].map((b) => ({
			hex: hex(b), b64url: b64urlEncode(b), base32: base32Encode(b),
		})),
		kdf: { password, params: kdf, masterKey: hex(masterKey), kek: hex(kek) },
		subkeys: [KDF_CONTEXT.keyEncryptionKey, KDF_CONTEXT.recovery, KDF_CONTEXT.prf].map((context) => ({
			root: hex(key), context, subkeyId: 1, subkey: hex(deriveSubkey(key, context)),
		})),
		envelopes,
		vault: {
			password,
			keyset: vault.keyset,
			vaultKey: hex(vaultKey),
			recoveryKey: vault.recoveryKey,
			recoveryKeyTyped: vault.recoveryKey.toLowerCase().replace(/-/g, ' ').replace(/o/g, '0').replace(/i/g, '1').replace(/b/g, '8'),
		},
		items,
		invalidItems: [
			{ type: 'login', title: 5 },
			{ type: 'spaceship' },
			{ type: 'login', urls: [1] },
			{ type: 'login', passkeys: [{ rpId: 'x', privateKey: 'y' }] },
			{ type: 'card', favorite: 'yes' },
			{ type: 'login', passkeys: [{ credentialId: 'a', rpId: 'x', privateKey: 'y', signCount: -1 }] },
		],
		folder: { id: folderId, record: { id: folderId, wrappedKey: folder.wrappedKey, data: folder.data, revision: 3, createdAt: 1, updatedAt: 2 }, name: 'Work 💼' },
		attachment: {
			itemKey: hex(itemKey),
			record: { id: attachmentId, itemId: items[0]!.id, wrappedKey: attachment.wrappedKey, meta: attachment.meta, size: attachment.blob.length, revision: 9, createdAt: 1 },
			blob: b64urlEncode(attachment.blob),
			contentLength: content.length,
		},
		passkeys,
		urlMatch: urls.map(([saved, page]) => ({ saved, page, result: matchUrl(saved, page) })),
		registrableDomain: ['https://login.example.co.uk/x', 'alice.github.io', 'localhost', 'www.example.com', 'a.b.c.kobe.jp', 'city.kobe.jp', 'www.city.kobe.jp', '192.168.1.1', 'com', 'foo.blogspot.com'].map((input) => ({
			input, output: registrableDomain(input),
		})),
		totp,
		cards,
		wordlist: { count: EFF_LARGE_WORDLIST.length, first: EFF_LARGE_WORDLIST[0], last: EFF_LARGE_WORDLIST.at(-1) },
	}

	mkdirSync(resolve(kit, 'Tests/VPassKitTests/Fixtures'), { recursive: true })
	writeFileSync(resolve(kit, 'Tests/VPassKitTests/Fixtures/vectors.json'), `${JSON.stringify(vectors, null, 2)}\n`)
	writeFileSync(resolve(kit, 'Sources/VPassKit/Resources/eff-wordlist.txt'), `${EFF_LARGE_WORDLIST.join('\n')}\n`)
})
