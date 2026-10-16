import {
	type AttachmentMeta,
	type AttachmentRecord,
	type BackupPayload,
	type FolderRecord,
	type ImportedEntry,
	type Item,
	type ItemRecord,
	type SyncResponse,
	ConflictError,
	createBackup,
	decryptAttachmentContent,
	decryptAttachmentMeta,
	decryptFolder,
	decryptItem,
	encryptAttachment,
	encryptFolder,
	encryptItem,
	exportNordPassCsv,
	itemSearchText,
	updateItem as applyItemUpdate,
	uuid,
	wipe,
} from '@vpass/core'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef, triggerRef } from 'vue'
import { api } from '../services/api.ts'
import { requireVaultKey } from './session.ts'

export interface VaultEntry {
	id: string
	item: Item
	revision: number
	createdAt: number
	updatedAt: number
	deletedAt: number | null
	/** Precomputed lower-case search haystack. */
	search: string
}

export interface FolderEntry {
	id: string
	name: string
	revision: number
}

export type Category = 'all' | 'login' | 'passkey' | 'note' | 'card' | 'identity' | 'favorites'

/** Per-object keys are kept out of reactive state. */
const itemKeys = new Map<string, Uint8Array>()
const folderKeys = new Map<string, Uint8Array>()
const attachmentMetaCache = new Map<string, AttachmentMeta>()

export const useVaultStore = defineStore('vault', () => {
	const entries = shallowRef(new Map<string, VaultEntry>())
	const folders = shallowRef(new Map<string, FolderEntry>())
	const attachments = shallowRef(new Map<string, AttachmentRecord>())
	const revision = ref(0)
	const unreadable = ref<string[]>([])
	const loaded = ref(false)

	/* ----- derived ----- */

	const active = computed(() => [...entries.value.values()].filter((e) => e.deletedAt === null))
	const trashed = computed(() => [...entries.value.values()].filter((e) => e.deletedAt !== null))
	const folderList = computed(() => [...folders.value.values()].sort((a, b) => a.name.localeCompare(b.name)))

	function inCategory(entry: VaultEntry, category: Category): boolean {
		const item = entry.item
		switch (category) {
		case 'all': return true
		case 'favorites': return item.favorite
		case 'passkey': return item.type === 'login' && item.passkeys.length > 0
		default: return item.type === category
		}
	}

	const counts = computed(() => {
		const result: Record<Category, number> = { all: 0, login: 0, passkey: 0, note: 0, card: 0, identity: 0, favorites: 0 }
		for (const entry of active.value) {
			for (const category of Object.keys(result) as Category[]) {
				if (inCategory(entry, category)) result[category]++
			}
		}
		return result
	})

	const folderCounts = computed(() => {
		const result = new Map<string, number>()
		for (const entry of active.value) {
			const id = entry.item.folderId
			if (id) result.set(id, (result.get(id) ?? 0) + 1)
		}
		return result
	})

	function filter(opts: { category?: Category, folderId?: string, trash?: boolean, query?: string }): VaultEntry[] {
		const terms = (opts.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
		return (opts.trash ? trashed.value : active.value)
			.filter((e) => !opts.category || inCategory(e, opts.category))
			.filter((e) => !opts.folderId || e.item.folderId === opts.folderId)
			.filter((e) => terms.every((t) => e.search.includes(t)))
			.sort((a, b) => a.item.title.localeCompare(b.item.title, undefined, { sensitivity: 'base' }))
	}

	function attachmentsFor(itemId: string): AttachmentRecord[] {
		return [...attachments.value.values()].filter((a) => a.itemId === itemId)
	}

	/* ----- sync ----- */

	function putEntry(record: ItemRecord): void {
		try {
			const dec = decryptItem(requireVaultKey(), record)
			itemKeys.set(record.id, dec.key)
			entries.value.set(record.id, {
				id: record.id,
				item: dec.item,
				revision: record.revision,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt,
				deletedAt: record.deletedAt,
				search: itemSearchText(dec.item),
			})
			unreadable.value = unreadable.value.filter((id) => id !== record.id)
		} catch (e) {
			console.error(e)
			if (!unreadable.value.includes(record.id)) unreadable.value.push(record.id)
		}
	}

	function putFolder(record: FolderRecord): void {
		try {
			const dec = decryptFolder(requireVaultKey(), record)
			folderKeys.set(record.id, dec.key)
			folders.value.set(record.id, { id: record.id, name: dec.folder.name, revision: record.revision })
		} catch (e) {
			console.error('Folder could not be decrypted', record.id, e)
		}
	}

	function removeEntry(id: string): void {
		entries.value.delete(id)
		wipe(itemKeys.get(id))
		itemKeys.delete(id)
		for (const att of attachmentsFor(id)) {
			attachments.value.delete(att.id)
		}
	}

	function apply(res: SyncResponse): void {
		res.items.forEach(putEntry)
		res.folders.forEach(putFolder)
		res.attachments.forEach((a) => attachments.value.set(a.id, a))
		for (const t of res.tombstones) {
			if (t.type === 'item') removeEntry(t.id)
			if (t.type === 'folder') folders.value.delete(t.id)
			if (t.type === 'attachment') attachments.value.delete(t.id)
		}
		revision.value = Math.max(revision.value, res.revision)
		notify()
	}

	function notify(): void {
		triggerRef(entries)
		triggerRef(folders)
		triggerRef(attachments)
	}

	async function load(): Promise<void> {
		clear()
		apply(await api.sync(0))
		loaded.value = true
	}

	async function sync(): Promise<void> {
		apply(await api.sync(revision.value))
	}

	function clear(): void {
		for (const key of [...itemKeys.values(), ...folderKeys.values()]) wipe(key)
		itemKeys.clear()
		folderKeys.clear()
		attachmentMetaCache.clear()
		entries.value = new Map()
		folders.value = new Map()
		attachments.value = new Map()
		revision.value = 0
		unreadable.value = []
		loaded.value = false
	}

	function track(record: ItemRecord): VaultEntry {
		putEntry(record)
		revision.value = Math.max(revision.value, record.revision)
		notify()
		return entries.value.get(record.id)!
	}

	/* ----- items ----- */

	async function createItem(item: Item): Promise<VaultEntry> {
		const id = uuid()
		const enc = encryptItem(requireVaultKey(), id, item)
		return track(await api.createItem({ id, wrappedKey: enc.wrappedKey, data: enc.data }))
	}

	/** Save an edit. On a conflict, the newer server copy is loaded and the error rethrown. */
	async function saveItem(id: string, next: Item): Promise<VaultEntry> {
		const entry = entries.value.get(id)
		if (!entry) throw new Error('Item not found')
		const updated = applyItemUpdate(entry.item, next)
		const enc = encryptItem(requireVaultKey(), id, updated, itemKeys.get(id))
		try {
			return track(await api.updateItem(id, { wrappedKey: enc.wrappedKey, data: enc.data, baseRevision: entry.revision }))
		} catch (e) {
			if (e instanceof ConflictError && e.current) {
				track(e.current as ItemRecord)
			}
			throw e
		}
	}

	async function patchItem(id: string, patch: Partial<Item>): Promise<VaultEntry> {
		const entry = entries.value.get(id)
		if (!entry) throw new Error('Item not found')
		return saveItem(id, { ...entry.item, ...patch } as Item)
	}

	async function trashItem(id: string): Promise<void> {
		track(await api.trashItem(id))
	}

	async function restoreItem(id: string): Promise<void> {
		track(await api.restoreItem(id))
	}

	async function deleteItem(id: string): Promise<void> {
		const { revision: rev } = await api.deleteItem(id)
		removeEntry(id)
		revision.value = Math.max(revision.value, rev)
		notify()
	}

	async function emptyTrash(): Promise<void> {
		for (const entry of trashed.value) {
			await deleteItem(entry.id)
		}
	}

	/* ----- folders ----- */

	async function createFolder(name: string): Promise<FolderEntry> {
		const id = uuid()
		const enc = encryptFolder(requireVaultKey(), id, { schemaVersion: 1, name: name.trim() })
		const record = await api.createFolder({ id, wrappedKey: enc.wrappedKey, data: enc.data })
		putFolder(record)
		notify()
		return folders.value.get(id)!
	}

	async function renameFolder(id: string, name: string): Promise<void> {
		const folder = folders.value.get(id)
		if (!folder) return
		const enc = encryptFolder(requireVaultKey(), id, { schemaVersion: 1, name: name.trim() }, folderKeys.get(id))
		putFolder(await api.updateFolder(id, { wrappedKey: enc.wrappedKey, data: enc.data, baseRevision: folder.revision }))
		notify()
	}

	/** Items in the folder are kept and moved out of it first. */
	async function deleteFolder(id: string): Promise<void> {
		for (const entry of [...entries.value.values()].filter((e) => e.item.folderId === id)) {
			await patchItem(entry.id, { folderId: null })
		}
		await api.deleteFolder(id)
		folders.value.delete(id)
		notify()
	}

	async function ensureFolders(names: string[]): Promise<Map<string, string>> {
		const byName = new Map(folderList.value.map((f) => [f.name.toLowerCase(), f.id]))
		for (const name of names) {
			if (!byName.has(name.toLowerCase())) {
				byName.set(name.toLowerCase(), (await createFolder(name)).id)
			}
		}
		return byName
	}

	/* ----- import / export ----- */

	async function importEntries(imported: Pick<ImportedEntry, 'item' | 'folderName'>[], folderNames: string[], onProgress?: (done: number, total: number) => void): Promise<number> {
		const folderIds = await ensureFolders(folderNames)
		const vk = requireVaultKey()
		let done = 0
		for (let i = 0; i < imported.length; i += 200) {
			const chunk = imported.slice(i, i + 200).map(({ item, folderName }) => {
				const id = uuid()
				const withFolder = { ...item, folderId: folderName ? folderIds.get(folderName.toLowerCase()) ?? null : null } as Item
				const enc = encryptItem(vk, id, withFolder)
				return { id, wrappedKey: enc.wrappedKey, data: enc.data }
			})
			const res = await api.createItems(chunk)
			res.items.forEach(putEntry)
			revision.value = Math.max(revision.value, res.revision)
			done += chunk.length
			onProgress?.(done, imported.length)
			notify()
		}
		return done
	}

	async function restoreBackup(payload: BackupPayload, onProgress?: (done: number, total: number) => void): Promise<number> {
		const folderName = new Map(payload.folders.map((f) => [f.id, f.name]))
		return importEntries(
			payload.items.map(({ item }) => ({ item, folderName: item.folderId ? folderName.get(item.folderId) ?? null : null })),
			payload.folders.map((f) => f.name),
			onProgress,
		)
	}

	function backupPayload(): BackupPayload {
		return {
			folders: folderList.value.map((f) => ({ id: f.id, name: f.name })),
			items: active.value.map((e) => ({ id: e.id, item: e.item })),
		}
	}

	function exportBackup(password: string): string {
		return createBackup(backupPayload(), password)
	}

	function exportCsv(): string {
		return exportNordPassCsv(active.value.map((e) => e.item), (id) => (id ? folders.value.get(id)?.name ?? '' : ''))
	}

	/* ----- attachments ----- */

	async function uploadAttachment(itemId: string, file: File): Promise<void> {
		const itemKey = itemKeys.get(itemId)
		if (!itemKey) throw new Error('Item not found')
		const content = new Uint8Array(await file.arrayBuffer())
		const id = uuid()
		const enc = encryptAttachment(itemKey, id, content, { name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size })
		const record = await api.uploadAttachment(itemId, enc)
		attachments.value.set(record.id, record)
		revision.value = Math.max(revision.value, record.revision)
		notify()
	}

	function attachmentMeta(record: AttachmentRecord): AttachmentMeta | null {
		const cached = attachmentMetaCache.get(record.id)
		if (cached) return cached
		const itemKey = itemKeys.get(record.itemId)
		if (!itemKey) return null
		try {
			const { key, meta } = decryptAttachmentMeta(itemKey, record)
			wipe(key)
			attachmentMetaCache.set(record.id, meta)
			return meta
		} catch {
			return null
		}
	}

	async function downloadAttachment(record: AttachmentRecord): Promise<{ meta: AttachmentMeta, content: Uint8Array }> {
		const itemKey = itemKeys.get(record.itemId)
		if (!itemKey) throw new Error('Item not found')
		const blob = await api.downloadAttachment(record.id)
		const { key, meta } = decryptAttachmentMeta(itemKey, record)
		try {
			return { meta, content: decryptAttachmentContent(key, record.id, blob) }
		} finally {
			wipe(key)
		}
	}

	async function deleteAttachment(id: string): Promise<void> {
		const { revision: rev } = await api.deleteAttachment(id)
		attachments.value.delete(id)
		attachmentMetaCache.delete(id)
		revision.value = Math.max(revision.value, rev)
		notify()
	}

	return {
		entries,
		folders,
		attachments,
		revision,
		unreadable,
		loaded,
		active,
		trashed,
		folderList,
		counts,
		folderCounts,
		filter,
		attachmentsFor,
		load,
		sync,
		clear,
		createItem,
		saveItem,
		patchItem,
		trashItem,
		restoreItem,
		deleteItem,
		emptyTrash,
		createFolder,
		renameFolder,
		deleteFolder,
		importEntries,
		restoreBackup,
		exportBackup,
		exportCsv,
		uploadAttachment,
		attachmentMeta,
		downloadAttachment,
		deleteAttachment,
	}
})
