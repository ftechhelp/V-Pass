import { execSync } from 'node:child_process'
import {
	ApiError,
	ConflictError,
	type ItemRecord,
	createVaultKeys,
	decryptAttachmentContent,
	decryptAttachmentMeta,
	decryptFolder,
	decryptItem,
	encryptAttachment,
	encryptFolder,
	encryptItem,
	generateKey,
	initCrypto,
	newItem,
	newKdfParams,
	newPrfSalt,
	randomBytes,
	unlockWithPassword,
	unwrapVaultKeyWithPrf,
	utf8Encode,
	uuid,
	wrapVaultKeyWithPrf,
} from '@vpass/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type TestUser, adminApi, createTestUser, deleteTestUser } from '../helpers.ts'

/**
 * Black-box tests of the V-Pass OCS API using the same @vpass/core client the
 * browser extension and desktop app will use. Requires `make dev-up`.
 */

let alice: TestUser
let bob: TestUser
let vaultKey: Uint8Array
const MASTER = 'correct horse battery staple 42'
const SENTINEL = `ZK-SENTINEL-${Date.now()}`

beforeAll(async () => {
	await initCrypto()
	alice = await createTestUser('vpass-alice')
	bob = await createTestUser('vpass-bob')
})

afterAll(async () => {
	if (process.env.VPASS_KEEP_USERS) return
	await Promise.all([alice && deleteTestUser(alice.id), bob && deleteTestUser(bob.id)])
})

function record(rec: ItemRecord) {
	return decryptItem(vaultKey, rec).item
}

describe('vault lifecycle', () => {
	it('reports no vault before setup', async () => {
		expect(await alice.api.getVault()).toBeNull()
	})

	it('rejects item writes before setup', async () => {
		const enc = encryptItem(generateKey(), uuid(), newItem('note'))
		await expect(alice.api.createItem(enc)).rejects.toMatchObject({ status: 404 })
	})

	it('creates a vault and unlocks it again from the server copy', async () => {
		const created = createVaultKeys(MASTER, newKdfParams(2, 32 * 1024 * 1024))
		const meta = await alice.api.createVault(created.keyset)
		expect(meta.revision).toBe(0)
		expect(meta.kdf).toEqual(created.keyset.kdf)
		vaultKey = created.vaultKey
		const fetched = (await alice.api.getVault())!
		expect(unlockWithPassword(MASTER, fetched)).toEqual(vaultKey)
	})

	it('refuses a second vault', async () => {
		const again = createVaultKeys('x', newKdfParams(2, 32 * 1024 * 1024))
		await expect(alice.api.createVault(again.keyset)).rejects.toMatchObject({ status: 409 })
	})

	it('rejects malformed KDF parameters', async () => {
		const bad = createVaultKeys('x', newKdfParams(2, 32 * 1024 * 1024)).keyset
		await expect(bob.api.createVault({ ...bad, kdf: { ...bad.kdf, memLimit: 1024 } })).rejects.toMatchObject({ status: 400 })
	})
})

describe('items', () => {
	let id: string
	let rev: number

	it('creates, syncs and decrypts an item', async () => {
		id = uuid()
		const item = newItem('login', { title: 'GitHub', username: 'alice', password: SENTINEL, urls: ['https://github.com'] })
		const created = await alice.api.createItem(encryptItem(vaultKey, id, item))
		expect(created.id).toBe(id)
		expect(created.revision).toBeGreaterThan(0)
		rev = created.revision
		const sync = await alice.api.sync(0)
		expect(sync.revision).toBe(rev)
		expect(record(sync.items.find((i) => i.id === id)!).password).toBe(SENTINEL)
	})

	it('updates with optimistic concurrency', async () => {
		const sync = await alice.api.sync(0)
		const dec = decryptItem(vaultKey, sync.items.find((i) => i.id === id)!)
		const enc = encryptItem(vaultKey, id, { ...dec.item, title: 'GitHub (work)' }, dec.key)
		const updated = await alice.api.updateItem(id, { wrappedKey: enc.wrappedKey, data: enc.data, baseRevision: rev })
		expect(updated.revision).toBeGreaterThan(rev)

		const stale = alice.api.updateItem(id, { wrappedKey: enc.wrappedKey, data: enc.data, baseRevision: rev })
		await expect(stale).rejects.toBeInstanceOf(ConflictError)
		const conflict = await stale.then(() => null, (e: ConflictError<ItemRecord>) => e)
		expect(conflict).toBeInstanceOf(ConflictError)
		expect(conflict!.current.revision).toBe(updated.revision)
		expect(record(conflict!.current).title).toBe('GitHub (work)')
		rev = updated.revision
	})

	it('returns only changes since a revision', async () => {
		const before = (await alice.api.sync(0)).revision
		const batch = Array.from({ length: 3 }, (_, i) => encryptItem(vaultKey, uuid(), newItem('note', { title: `Note ${i}` })))
		const res = await alice.api.createItems(batch)
		expect(res.items).toHaveLength(3)
		expect(new Set(res.items.map((i) => i.revision)).size).toBe(1)
		const delta = await alice.api.sync(before)
		expect(delta.items.map((i) => i.id).sort()).toEqual(batch.map((b) => b.id).sort())
	})

	it('moves to trash, restores and deletes with a tombstone', async () => {
		const trashed = await alice.api.trashItem(id)
		expect(trashed.deletedAt).not.toBeNull()
		const restored = await alice.api.restoreItem(id)
		expect(restored.deletedAt).toBeNull()
		const before = restored.revision
		await alice.api.deleteItem(id)
		const delta = await alice.api.sync(before)
		expect(delta.tombstones).toContainEqual(expect.objectContaining({ type: 'item', id }))
		expect(delta.items.find((i) => i.id === id)).toBeUndefined()
	})

	it('rejects plaintext and malformed payloads', async () => {
		const enc = encryptItem(vaultKey, uuid(), newItem('note'))
		await expect(alice.api.createItem({ ...enc, data: JSON.stringify({ password: 'hunter2' }) })).rejects.toMatchObject({ status: 400 })
		await expect(alice.api.createItem({ ...enc, id: 'not-a-uuid' })).rejects.toMatchObject({ status: 400 })
		await expect(alice.api.createItem({ ...enc, data: `1.${'A'.repeat(32)}.${'B'.repeat(1_100_000)}` })).rejects.toMatchObject({ status: 400 })
	})
})

describe('folders', () => {
	it('creates, renames and deletes a folder', async () => {
		const id = uuid()
		const enc = encryptFolder(vaultKey, id, { schemaVersion: 1, name: 'Work' })
		const created = await alice.api.createFolder({ id, wrappedKey: enc.wrappedKey, data: enc.data })
		const renamed = encryptFolder(vaultKey, id, { schemaVersion: 1, name: 'Job' }, enc.key)
		const updated = await alice.api.updateFolder(id, { wrappedKey: renamed.wrappedKey, data: renamed.data, baseRevision: created.revision })
		expect(decryptFolder(vaultKey, updated).folder.name).toBe('Job')
		await alice.api.deleteFolder(id)
		const delta = await alice.api.sync(updated.revision)
		expect(delta.tombstones).toContainEqual(expect.objectContaining({ type: 'folder', id }))
	})
})

describe('attachments', () => {
	it('stores only ciphertext and round-trips the file', async () => {
		const itemId = uuid()
		const enc = encryptItem(vaultKey, itemId, newItem('note', { title: 'Passport' }))
		await alice.api.createItem(enc)
		const content = utf8Encode(`${SENTINEL} passport scan`)
		const att = encryptAttachment(enc.key, uuid(), content, { name: 'passport.txt', mimeType: 'text/plain', size: content.length })
		const created = await alice.api.uploadAttachment(itemId, att)
		expect(created.itemId).toBe(itemId)

		const blob = await alice.api.downloadAttachment(att.id)
		expect(blob).toEqual(att.blob)
		const { key, meta } = decryptAttachmentMeta(enc.key, created)
		expect(meta.name).toBe('passport.txt')
		expect(decryptAttachmentContent(key, att.id, blob)).toEqual(content)

		await alice.api.deleteAttachment(att.id)
		await expect(alice.api.downloadAttachment(att.id)).rejects.toMatchObject({ status: 404 })
	})
})

describe('passkey unlock keys', () => {
	it('stores a PRF-wrapped vault key that only the PRF output opens', async () => {
		const credentialId = 'cred' + uuid().replace(/-/g, '')
		const prfOutput = randomBytes(32)
		const created = await alice.api.createUnlockKey({
			credentialId,
			prfSalt: newPrfSalt(),
			wrappedVaultKey: wrapVaultKeyWithPrf(vaultKey, prfOutput, credentialId),
			label: 'Laptop',
		})
		const listed = (await alice.api.listUnlockKeys()).find((k) => k.id === created.id)!
		expect(unwrapVaultKeyWithPrf(listed.wrappedVaultKey, prfOutput, credentialId)).toEqual(vaultKey)
		await alice.api.markUnlockKeyUsed(created.id)
		expect((await alice.api.listUnlockKeys()).find((k) => k.id === created.id)!.lastUsedAt).not.toBeNull()
		await alice.api.deleteUnlockKey(created.id)
		expect((await alice.api.listUnlockKeys()).find((k) => k.id === created.id)).toBeUndefined()
	})
})

describe('isolation between users', () => {
	it('never exposes one user\'s vault to another', async () => {
		const aliceItems = (await alice.api.sync(0)).items
		expect(aliceItems.length).toBeGreaterThan(0)
		const created = createVaultKeys('bob master pw 123', newKdfParams(2, 32 * 1024 * 1024))
		await bob.api.createVault(created.keyset)
		const bobSync = await bob.api.sync(0)
		expect(bobSync.items).toEqual([])
		const target = aliceItems[0]!
		await expect(bob.api.updateItem(target.id, { wrappedKey: target.wrappedKey, data: target.data, baseRevision: target.revision }))
			.rejects.toMatchObject({ status: 404 })
		await expect(bob.api.trashItem(target.id)).rejects.toMatchObject({ status: 404 })
	})

	it('keeps the admin settings admin-only', async () => {
		await expect(alice.api.getAdminSettings()).rejects.toBeInstanceOf(ApiError)
		const settings = await adminApi().getAdminSettings()
		expect(settings).toMatchObject({ hibpEnabled: expect.any(Boolean), maxAttachmentMb: expect.any(Number) })
	})
})

describe.runIf(process.env.VPASS_TEST_HIBP)('breach check proxy', () => {
	it('returns a padded k-anonymity range', async () => {
		const range = await alice.api.breachRange('5BAA6')
		expect(range).toContain('1E4C9B93F3F0682250B6CF8331B7EE68FD8')
	})
})

/**
 * Zero-knowledge proof: after storing the sentinel as a password, a note and a file,
 * neither the database dump nor the app data folder may contain it in plaintext.
 */
describe.runIf(process.env.VPASS_ZK_CHECK)('zero knowledge', () => {
	it('stores no plaintext anywhere on the server', async () => {
		await alice.api.createItem(encryptItem(vaultKey, uuid(), newItem('note', { title: SENTINEL, notes: SENTINEL })))
		const compose = 'docker compose -f dev/docker-compose.yml'
		const dump = execSync(`${compose} exec -T db pg_dump -U nextcloud nextcloud`, { maxBuffer: 512 * 1024 * 1024 }).toString()
		expect(dump).toContain('vpass_items')
		expect(dump).not.toContain(SENTINEL)
		const grep = execSync(`${compose} exec -T nextcloud sh -c "grep -rl '${SENTINEL}' /var/www/html/data || true"`).toString().trim()
		expect(grep).toBe('')
	})
})
