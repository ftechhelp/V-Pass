import { beforeAll, describe, expect, it } from 'vitest'
import {
	AAD,
	DecryptionError,
	InvalidRecoveryKeyError,
	WrongPasswordError,
	b64urlDecode,
	b64urlEncode,
	base32Decode,
	base32Encode,
	createVaultKeys,
	decryptAttachmentContent,
	decryptAttachmentMeta,
	decryptItem,
	decryptStream,
	encryptAttachment,
	encryptItem,
	encryptStream,
	generateKey,
	initCrypto,
	newItem,
	newKdfParams,
	open,
	parseRecoveryKey,
	randomBytes,
	rewrapWithPassword,
	rotateRecoveryKey,
	seal,
	unlockWithPassword,
	unlockWithRecoveryKey,
	unwrapVaultKeyWithPrf,
	utf8Decode,
	utf8Encode,
	uuid,
	UUID_RE,
	wrapVaultKeyWithPrf,
} from '../src/index.ts'
import type { ItemRecord } from '../src/index.ts'

// Lower Argon2 cost in tests only; production uses newKdfParams() defaults.
const fastKdf = () => newKdfParams(2, 32 * 1024 * 1024)

beforeAll(async () => {
	await initCrypto()
})

describe('encoding', () => {
	it('round-trips base64url, including empty and odd lengths', () => {
		for (const len of [0, 1, 2, 3, 31, 32, 33, 1000, 100_000]) {
			const bytes = randomBytes(len)
			const enc = b64urlEncode(bytes)
			expect(enc).toMatch(/^[A-Za-z0-9_-]*$/)
			expect(b64urlDecode(enc)).toEqual(bytes)
		}
	})

	it('matches RFC 4648 base32 test vectors', () => {
		const vectors: [string, string][] = [['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI']]
		for (const [plain, encoded] of vectors) {
			expect(base32Encode(utf8Encode(plain))).toBe(encoded)
			expect(utf8Decode(base32Decode(encoded))).toBe(plain)
		}
		expect(utf8Decode(base32Decode('mzxw 6ytb-oi======'))).toBe('foobar')
	})

	it('generates RFC 4122 v4 UUIDs', () => {
		const ids = new Set(Array.from({ length: 100 }, () => uuid()))
		expect(ids.size).toBe(100)
		for (const id of ids) expect(id).toMatch(UUID_RE)
	})
})

describe('envelope', () => {
	it('encrypts and decrypts with matching key and AAD', () => {
		const key = generateKey()
		const sealed = seal(key, utf8Encode('hello'), 'ctx')
		expect(sealed).toMatch(/^1\./)
		expect(utf8Decode(open(key, sealed, 'ctx'))).toBe('hello')
	})

	it('uses a fresh nonce every time', () => {
		const key = generateKey()
		expect(seal(key, utf8Encode('x'), 'a')).not.toBe(seal(key, utf8Encode('x'), 'a'))
	})

	it('rejects wrong key, wrong AAD and tampering', () => {
		const key = generateKey()
		const sealed = seal(key, utf8Encode('secret'), 'vpass:item:A')
		expect(() => open(generateKey(), sealed, 'vpass:item:A')).toThrow(DecryptionError)
		expect(() => open(key, sealed, 'vpass:item:B')).toThrow(DecryptionError)
		const [v, n, c] = sealed.split('.')
		const flipped = c!.slice(0, -2) + (c!.at(-2) === 'A' ? 'B' : 'A') + c!.at(-1)
		expect(() => open(key, `${v}.${n}.${flipped}`, 'vpass:item:A')).toThrow(DecryptionError)
		expect(() => open(key, 'garbage', 'vpass:item:A')).toThrow(DecryptionError)
	})
})

describe('vault key lifecycle', () => {
	it('creates a vault and unlocks with the master password', () => {
		const { keyset, vaultKey, recoveryKey } = createVaultKeys('correct horse battery staple', fastKdf())
		expect(keyset.kdf.algorithm).toBe('argon2id')
		expect(recoveryKey).toMatch(/^([A-Z2-7]{4}-){13}[A-Z2-7]{4}$/)
		expect(unlockWithPassword('correct horse battery staple', keyset)).toEqual(vaultKey)
	})

	it('rejects a wrong master password', () => {
		const { keyset } = createVaultKeys('right', fastKdf())
		expect(() => unlockWithPassword('wrong', keyset)).toThrow(WrongPasswordError)
	})

	it('normalises unicode in the master password (NFC vs NFD)', () => {
		const nfc = 'café'
		const nfd = 'café'
		const { keyset, vaultKey } = createVaultKeys(nfc, fastKdf())
		expect(unlockWithPassword(nfd, keyset)).toEqual(vaultKey)
	})

	it('unlocks with the recovery key, tolerating formatting and look-alike characters', () => {
		const { keyset, vaultKey, recoveryKey } = createVaultKeys('pw', fastKdf())
		expect(unlockWithRecoveryKey(recoveryKey, keyset)).toEqual(vaultKey)
		const sloppy = ` ${recoveryKey.toLowerCase().replace(/-/g, ' ').replace(/o/g, '0')} `
		expect(unlockWithRecoveryKey(sloppy, keyset)).toEqual(vaultKey)
	})

	it('detects recovery key typos via the checksum', () => {
		const { recoveryKey } = createVaultKeys('pw', fastKdf())
		const typo = (recoveryKey[0] === 'A' ? 'B' : 'A') + recoveryKey.slice(1)
		expect(() => parseRecoveryKey(typo)).toThrow(InvalidRecoveryKeyError)
		expect(() => parseRecoveryKey('too-short')).toThrow(InvalidRecoveryKeyError)
	})

	it('rejects a valid recovery key from another vault', () => {
		const a = createVaultKeys('pw', fastKdf())
		const b = createVaultKeys('pw', fastKdf())
		expect(() => unlockWithRecoveryKey(b.recoveryKey, a.keyset)).toThrow(InvalidRecoveryKeyError)
	})

	it('changes the master password without changing the vault key', () => {
		const { keyset, vaultKey } = createVaultKeys('old', fastKdf())
		const item = encryptItem(vaultKey, 'id-1', newItem('note', { title: 'kept' }))
		const updated = { ...keyset, ...rewrapWithPassword(vaultKey, 'new', fastKdf()) }
		expect(() => unlockWithPassword('old', updated)).toThrow(WrongPasswordError)
		const vk = unlockWithPassword('new', updated)
		const record: ItemRecord = { ...item, revision: 1, createdAt: 0, updatedAt: 0, deletedAt: null }
		expect(decryptItem(vk, record).item.title).toBe('kept')
	})

	it('rotating the recovery key invalidates the old one', () => {
		const { keyset, vaultKey, recoveryKey } = createVaultKeys('pw', fastKdf())
		const rotated = rotateRecoveryKey(vaultKey)
		const updated = { ...keyset, recoveryWrappedVaultKey: rotated.recoveryWrappedVaultKey }
		expect(() => unlockWithRecoveryKey(recoveryKey, updated)).toThrow(InvalidRecoveryKeyError)
		expect(unlockWithRecoveryKey(rotated.recoveryKey, updated)).toEqual(vaultKey)
	})
})

describe('passkey PRF unlock', () => {
	it('wraps and unwraps the vault key with a PRF output', () => {
		const vk = generateKey()
		const prf = randomBytes(32)
		const wrapped = wrapVaultKeyWithPrf(vk, prf, 'cred-1')
		expect(unwrapVaultKeyWithPrf(wrapped, prf, 'cred-1')).toEqual(vk)
		expect(() => unwrapVaultKeyWithPrf(wrapped, randomBytes(32), 'cred-1')).toThrow(DecryptionError)
		expect(() => unwrapVaultKeyWithPrf(wrapped, prf, 'cred-2')).toThrow(DecryptionError)
	})
})

describe('item records', () => {
	it('round-trips every item type', () => {
		const vk = generateKey()
		const items = [
			newItem('login', { title: 'GitHub', username: 'alice', password: 'pw', urls: ['https://github.com'] }),
			newItem('note', { title: 'Note', notes: 'multi\nline 🔑' }),
			newItem('card', { title: 'Visa', number: '4111111111111111', expMonth: '07', expYear: '2029' }),
			newItem('identity', { title: 'Me', firstName: 'Alice', email: 'a@example.com' }),
		]
		for (const item of items) {
			const id = uuid()
			const enc = encryptItem(vk, id, item)
			const dec = decryptItem(vk, { ...enc, revision: 1, createdAt: 0, updatedAt: 0, deletedAt: null })
			expect(dec.item).toEqual(item)
			expect(dec.key).toEqual(enc.key)
		}
	})

	it('detects a server swapping ciphertext between items', () => {
		const vk = generateKey()
		const a = encryptItem(vk, 'item-a', newItem('note', { title: 'A' }))
		const b = encryptItem(vk, 'item-b', newItem('note', { title: 'B' }))
		const swapped: ItemRecord = { id: 'item-a', wrappedKey: b.wrappedKey, data: b.data, revision: 1, createdAt: 0, updatedAt: 0, deletedAt: null }
		expect(() => decryptItem(vk, swapped)).toThrow()
		const swappedData: ItemRecord = { id: 'item-a', wrappedKey: a.wrappedKey, data: b.data, revision: 1, createdAt: 0, updatedAt: 0, deletedAt: null }
		expect(() => decryptItem(vk, swappedData)).toThrow()
	})

	it('keeps fields from newer clients (forward compatibility)', () => {
		const vk = generateKey()
		const item = { ...newItem('login', { title: 'x' }), futureField: { a: 1 } }
		const enc = encryptItem(vk, 'id', item as never)
		const dec = decryptItem(vk, { ...enc, revision: 1, createdAt: 0, updatedAt: 0, deletedAt: null })
		expect((dec.item as Record<string, unknown>).futureField).toEqual({ a: 1 })
	})
})

describe('attachments', () => {
	it.each([0, 1, 65_535, 65_536, 65_537, 200_000])('round-trips %i bytes', (size) => {
		const key = generateKey()
		const data = randomBytes(size)
		const enc = encryptStream(key, data, AAD.attachmentData('a'))
		expect(decryptStream(key, enc, AAD.attachmentData('a'))).toEqual(data)
	})

	it('detects truncation, extension and wrong AAD', () => {
		const key = generateKey()
		const enc = encryptStream(key, randomBytes(150_000), 'aad')
		expect(() => decryptStream(key, enc.subarray(0, enc.length - 100), 'aad')).toThrow(DecryptionError)
		const chunkEnd = 24 + 65_536 + 17
		expect(() => decryptStream(key, enc.subarray(0, chunkEnd), 'aad')).toThrow(DecryptionError)
		expect(() => decryptStream(key, new Uint8Array([...enc, 1, 2, 3]), 'aad')).toThrow(DecryptionError)
		expect(() => decryptStream(key, enc, 'other')).toThrow(DecryptionError)
	})

	it('encrypts file name and content under the item key', () => {
		const itemKey = generateKey()
		const content = utf8Encode('scan of passport')
		const enc = encryptAttachment(itemKey, 'att-1', content, { name: 'passport.pdf', mimeType: 'application/pdf', size: content.length })
		const { key, meta } = decryptAttachmentMeta(itemKey, enc)
		expect(meta.name).toBe('passport.pdf')
		expect(decryptAttachmentContent(key, 'att-1', enc.blob)).toEqual(content)
		expect(() => decryptAttachmentMeta(generateKey(), enc)).toThrow(DecryptionError)
	})
})
