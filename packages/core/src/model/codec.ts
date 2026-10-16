import { decryptStream, encryptStream } from '../crypto/attachments.ts'
import { openJson, sealJson } from '../crypto/envelope.ts'
import { AAD, generateKey, unwrapKey, wrapKey } from '../crypto/keys.ts'
import { type Folder, type Item, FolderSchema, ItemSchema } from './items.ts'
import type { AttachmentRecord, EncryptedObject, FolderRecord, ItemRecord } from './records.ts'

export interface DecryptedItem {
	id: string
	item: Item
	/** Per-item key; needed to encrypt/decrypt this item's attachments. */
	key: Uint8Array
	revision: number
	createdAt: number
	updatedAt: number
	deletedAt: number | null
}

export interface DecryptedFolder {
	id: string
	folder: Folder
	key: Uint8Array
	revision: number
}

export class ItemDecodeError extends Error {
	constructor(public readonly id: string, cause: unknown) {
		super(`Item ${id} could not be decrypted or parsed`, { cause })
		this.name = 'ItemDecodeError'
	}
}

/** Encrypt an item. Pass the existing item key when updating so attachments stay readable. */
export function encryptItem(vaultKey: Uint8Array, id: string, item: Item, itemKey?: Uint8Array): EncryptedObject & { key: Uint8Array } {
	const key = itemKey ?? generateKey()
	return {
		id,
		key,
		wrappedKey: wrapKey(vaultKey, key, AAD.itemKey(id)),
		data: sealJson(key, ItemSchema.parse(item), AAD.item(id)),
	}
}

export function decryptItem(vaultKey: Uint8Array, record: ItemRecord): DecryptedItem {
	try {
		const key = unwrapKey(vaultKey, record.wrappedKey, AAD.itemKey(record.id))
		const item = ItemSchema.parse(openJson(key, record.data, AAD.item(record.id)))
		return {
			id: record.id,
			item,
			key,
			revision: record.revision,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
			deletedAt: record.deletedAt,
		}
	} catch (e) {
		throw new ItemDecodeError(record.id, e)
	}
}

export function encryptFolder(vaultKey: Uint8Array, id: string, folder: Folder, folderKey?: Uint8Array): EncryptedObject & { key: Uint8Array } {
	const key = folderKey ?? generateKey()
	return {
		id,
		key,
		wrappedKey: wrapKey(vaultKey, key, AAD.folderKey(id)),
		data: sealJson(key, FolderSchema.parse(folder), AAD.folder(id)),
	}
}

export function decryptFolder(vaultKey: Uint8Array, record: FolderRecord): DecryptedFolder {
	const key = unwrapKey(vaultKey, record.wrappedKey, AAD.folderKey(record.id))
	return {
		id: record.id,
		folder: FolderSchema.parse(openJson(key, record.data, AAD.folder(record.id))),
		key,
		revision: record.revision,
	}
}

export interface AttachmentMeta {
	name: string
	mimeType: string
	/** Plaintext size in bytes. */
	size: number
}

export interface EncryptedAttachment {
	id: string
	wrappedKey: string
	meta: string
	blob: Uint8Array
}

export function encryptAttachment(itemKey: Uint8Array, id: string, content: Uint8Array, meta: AttachmentMeta): EncryptedAttachment {
	const key = generateKey()
	return {
		id,
		wrappedKey: wrapKey(itemKey, key, AAD.attachmentKey(id)),
		meta: sealJson(key, meta, AAD.attachmentMeta(id)),
		blob: encryptStream(key, content, AAD.attachmentData(id)),
	}
}

export function decryptAttachmentMeta(itemKey: Uint8Array, record: Pick<AttachmentRecord, 'id' | 'wrappedKey' | 'meta'>): { key: Uint8Array, meta: AttachmentMeta } {
	const key = unwrapKey(itemKey, record.wrappedKey, AAD.attachmentKey(record.id))
	return { key, meta: openJson<AttachmentMeta>(key, record.meta, AAD.attachmentMeta(record.id)) }
}

export function decryptAttachmentContent(attachmentKey: Uint8Array, id: string, blob: Uint8Array): Uint8Array {
	return decryptStream(attachmentKey, blob, AAD.attachmentData(id))
}
