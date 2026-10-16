import { openJson, sealJson } from '../crypto/envelope.ts'
import { DecryptionError } from '../crypto/errors.ts'
import { type KdfParams, deriveMasterKey, newKdfParams } from '../crypto/kdf.ts'
import { AAD, KDF_CONTEXT, deriveSubkey, wipe } from '../crypto/keys.ts'
import { type Item, ItemSchema } from '../model/items.ts'

/**
 * Encrypted, portable backup (`.vpass`): a JSON file protected by a password
 * chosen at export time (Argon2id → XChaCha20-Poly1305). Attachments are not included.
 */
export interface BackupFile {
	format: 'vpass-backup'
	version: 1
	createdAt: string
	kdf: KdfParams
	data: string
}

export interface BackupPayload {
	folders: { id: string, name: string }[]
	items: { id: string, item: Item }[]
}

function backupKey(password: string, kdf: KdfParams): Uint8Array {
	const master = deriveMasterKey(password, kdf)
	try {
		return deriveSubkey(master, KDF_CONTEXT.backup)
	} finally {
		wipe(master)
	}
}

export function createBackup(payload: BackupPayload, password: string): string {
	const kdf = newKdfParams()
	const key = backupKey(password, kdf)
	try {
		const file: BackupFile = {
			format: 'vpass-backup',
			version: 1,
			createdAt: new Date().toISOString(),
			kdf,
			data: sealJson(key, payload, AAD.backup),
		}
		return JSON.stringify(file, null, 2)
	} finally {
		wipe(key)
	}
}

export function isBackupFile(text: string): boolean {
	try {
		const parsed = JSON.parse(text) as Partial<BackupFile>
		return parsed.format === 'vpass-backup'
	} catch {
		return false
	}
}

export function openBackup(text: string, password: string): BackupPayload {
	const file = JSON.parse(text) as BackupFile
	if (file.format !== 'vpass-backup' || file.version !== 1) {
		throw new Error('Unsupported backup file')
	}
	const key = backupKey(password, file.kdf)
	try {
		const payload = openJson<BackupPayload>(key, file.data, AAD.backup)
		return {
			folders: payload.folders.map((f) => ({ id: String(f.id), name: String(f.name) })),
			items: payload.items.map((e) => ({ id: String(e.id), item: ItemSchema.parse(e.item) })),
		}
	} catch (e) {
		if (e instanceof DecryptionError) {
			throw new DecryptionError('Wrong backup password or damaged file')
		}
		throw e
	} finally {
		wipe(key)
	}
}
