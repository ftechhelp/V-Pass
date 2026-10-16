import type { KdfParams } from '../crypto/kdf.ts'

/**
 * Wire format exchanged with the Nextcloud server (OCS API).
 * Every `data`/`meta`/`wrapped*` field is an encrypted envelope; timestamps are unix seconds.
 */

export interface VaultMeta {
	kdf: KdfParams
	wrappedVaultKey: string
	recoveryWrappedVaultKey: string
	revision: number
	createdAt: number
	updatedAt: number
}

export interface ItemRecord {
	id: string
	wrappedKey: string
	data: string
	revision: number
	createdAt: number
	updatedAt: number
	/** Set while the item is in the trash. */
	deletedAt: number | null
}

export interface FolderRecord {
	id: string
	wrappedKey: string
	data: string
	revision: number
	createdAt: number
	updatedAt: number
}

export interface AttachmentRecord {
	id: string
	itemId: string
	wrappedKey: string
	/** Encrypted {name, mimeType, size}. */
	meta: string
	/** Size of the encrypted blob in bytes. */
	size: number
	revision: number
	createdAt: number
}

export interface Tombstone {
	type: 'item' | 'folder' | 'attachment'
	id: string
	revision: number
}

export interface SyncResponse {
	revision: number
	items: ItemRecord[]
	folders: FolderRecord[]
	attachments: AttachmentRecord[]
	tombstones: Tombstone[]
}

export interface UnlockKeyRecord {
	id: number
	type: 'passkey_prf'
	credentialId: string
	prfSalt: string
	wrappedVaultKey: string
	label: string
	createdAt: number
	lastUsedAt: number | null
}

export interface EncryptedObject {
	id: string
	wrappedKey: string
	data: string
}
