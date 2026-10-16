import {
	type DecryptedItem,
	type Item,
	type ItemRecord,
	ConflictError,
	VaultCache,
	decryptFolder,
	decryptItem,
	encryptItem,
	initCrypto,
	parseItem,
	updateItem as applyItemUpdate,
	uuid,
	wipe,
} from '@vpass/core'
import type { ItemView } from '../shared/protocol.ts'
import { api } from './account.ts'
import { fetchVaultMeta, getVaultKey, lock, onLockChange, requireVaultKey } from './session.ts'
import { local } from './storage.ts'

/**
 * The vault as the extension sees it: the encrypted cache (persisted in
 * chrome.storage.local, ciphertext only) plus decrypted items held in memory
 * while unlocked. After a worker restart items are decrypted again on demand.
 */

let cache: VaultCache | null = null
const decrypted = new Map<string, DecryptedItem>()
const folderNames = new Map<string, string>()
let decryptedWith: Uint8Array | null = null
let syncing: Promise<void> | null = null
const changeListeners: (() => void)[] = []

export function onVaultChange(listener: () => void): void {
	changeListeners.push(listener)
}

function changed(): void {
	changeListeners.forEach((l) => {
		try {
			l()
		} catch (e) {
			console.error(e)
		}
	})
}

async function loadCache(): Promise<VaultCache> {
	cache ??= VaultCache.fromJSON(await local.get('cache'))
	return cache
}

async function persist(): Promise<void> {
	await local.set({ cache: (await loadCache()).toJSON() })
}

/** Drop every decrypted item and key from memory. */
function forget(): void {
	for (const entry of decrypted.values()) {
		wipe(entry.key)
	}
	decrypted.clear()
	folderNames.clear()
	decryptedWith = null
}

onLockChange(() => {
	getVaultKey().then((key) => {
		if (!key) forget()
	}).catch(() => forget())
})

/** Every readable item (trash included), decrypting what changed since last time. */
async function allItems(): Promise<DecryptedItem[]> {
	const key = await requireVaultKey()
	const current = await loadCache()
	await initCrypto()
	if (decryptedWith !== key) {
		forget()
		decryptedWith = key
	}
	for (const record of current.items.values()) {
		const known = decrypted.get(record.id)
		if (!known || known.revision !== record.revision || known.deletedAt !== record.deletedAt) {
			try {
				if (known) wipe(known.key)
				decrypted.set(record.id, decryptItem(key, record))
			} catch (e) {
				console.error('V-Pass could not decrypt item', record.id, e)
				decrypted.delete(record.id)
			}
		}
	}
	for (const [id, entry] of decrypted) {
		if (!current.items.has(id)) {
			wipe(entry.key)
			decrypted.delete(id)
		}
	}
	folderNames.clear()
	for (const record of current.folders.values()) {
		try {
			const folder = decryptFolder(key, record)
			wipe(folder.key)
			folderNames.set(record.id, folder.folder.name)
		} catch (e) {
			console.error('V-Pass could not decrypt folder', record.id, e)
		}
	}
	return [...decrypted.values()]
}

/** Decrypted items that are not in the trash. Throws while locked. */
export async function activeItems(): Promise<DecryptedItem[]> {
	return (await allItems()).filter((entry) => entry.deletedAt === null)
}

export async function findItem(id: string): Promise<DecryptedItem | null> {
	return (await activeItems()).find((entry) => entry.id === id) ?? null
}

export async function itemViews(): Promise<ItemView[]> {
	return (await activeItems()).map((entry) => ({
		id: entry.id,
		item: entry.item,
		updatedAt: entry.updatedAt,
		folderName: entry.item.folderId ? folderNames.get(entry.item.folderId) ?? null : null,
	}))
}

/**
 * Pull changes from the server. Works while locked (it only moves ciphertext).
 * If the vault was deleted or recreated meanwhile, lock and start over.
 */
export function sync(): Promise<void> {
	syncing ??= (async () => {
		try {
			const previous = await local.get('vaultMeta')
			const meta = await fetchVaultMeta()
			const current = await loadCache()
			if (!meta || (previous && previous.createdAt !== meta.createdAt)) {
				await lock()
				current.clear()
			}
			if (meta) {
				current.applySync(await (await api()).sync(current.revision))
			}
			await persist()
			await local.set({ lastSync: Date.now(), syncError: null })
			changed()
		} catch (e) {
			await local.set({ syncError: (e as Error).message })
			throw e
		} finally {
			syncing = null
		}
	})()
	return syncing
}

/** Forget the cached vault entirely (disconnect). */
export async function clearVault(): Promise<void> {
	forget()
	cache = new VaultCache()
	await local.remove('cache', 'vaultMeta', 'lastSync', 'syncError')
}

export async function createItem(item: Item): Promise<DecryptedItem> {
	const key = await requireVaultKey()
	await initCrypto()
	const id = uuid()
	const enc = encryptItem(key, id, item)
	const record = await (await api()).createItem({ id, wrappedKey: enc.wrappedKey, data: enc.data })
	return track(record, enc.key, parseItem(item))
}

/**
 * Change one item. `change` gets the current item and returns the new one (or
 * null for "nothing to do"). If another device changed it first, `change` is
 * re-applied once to the server's copy.
 */
export async function modifyItem(id: string, change: (item: Item) => Item | null): Promise<DecryptedItem> {
	const key = await requireVaultKey()
	let current = await findItem(id)
	if (!current) {
		throw new Error('This item no longer exists')
	}
	for (let attempt = 0; ; attempt++) {
		const next = change(current.item)
		if (!next) {
			return current
		}
		const updated = applyItemUpdate(current.item, next)
		const enc = encryptItem(key, id, updated, current.key)
		try {
			const record = await (await api()).updateItem(id, { wrappedKey: enc.wrappedKey, data: enc.data, baseRevision: current.revision })
			return track(record, current.key, updated)
		} catch (e) {
			if (e instanceof ConflictError && e.current && attempt === 0) {
				const server = e.current as ItemRecord
				;(await loadCache()).putItem(server)
				current = decryptItem(key, server)
				decrypted.set(id, current)
				continue
			}
			throw e
		}
	}
}

async function track(record: ItemRecord, itemKey: Uint8Array, item: Item): Promise<DecryptedItem> {
	;(await loadCache()).putItem(record)
	await persist()
	const entry: DecryptedItem = {
		id: record.id,
		item,
		key: itemKey,
		revision: record.revision,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		deletedAt: record.deletedAt,
	}
	decrypted.set(record.id, entry)
	changed()
	return entry
}
