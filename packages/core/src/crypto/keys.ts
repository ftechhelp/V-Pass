import { open, seal } from './envelope.ts'
import { DecryptionError } from './errors.ts'
import { randomBytes } from './random.ts'
import { na } from './sodium.ts'

export const KEY_BYTES = 32

/**
 * AAD labels. Every ciphertext is bound to exactly one of these, so a blob
 * produced for one purpose/object can never be accepted for another.
 */
export const AAD = {
	vaultKeyPassword: 'vpass:vk:password',
	vaultKeyRecovery: 'vpass:vk:recovery',
	vaultKeyPrf: (credentialId: string) => `vpass:vk:prf:${credentialId}`,
	itemKey: (id: string) => `vpass:item-key:${id}`,
	item: (id: string) => `vpass:item:${id}`,
	folderKey: (id: string) => `vpass:folder-key:${id}`,
	folder: (id: string) => `vpass:folder:${id}`,
	attachmentKey: (id: string) => `vpass:attachment-key:${id}`,
	attachmentMeta: (id: string) => `vpass:attachment-meta:${id}`,
	attachmentData: (id: string) => `vpass:attachment-data:${id}`,
	backup: 'vpass:backup:v1',
} as const

/** libsodium KDF contexts (exactly 8 bytes each). */
export const KDF_CONTEXT = {
	keyEncryptionKey: 'vpassKEK',
	recovery: 'vpassRCV',
	prf: 'vpassPRF',
	backup: 'vpassBKP',
} as const

export function generateKey(): Uint8Array {
	return randomBytes(KEY_BYTES)
}

/** Derive a 32-byte subkey from 32 bytes of uniformly random key material (BLAKE2b-based). */
export function deriveSubkey(rootKey: Uint8Array, context: string, subkeyId = 1): Uint8Array {
	if (rootKey.length !== KEY_BYTES) {
		throw new RangeError('Root key must be 32 bytes')
	}
	return na().crypto_kdf_derive_from_key(KEY_BYTES, subkeyId, context, rootKey)
}

export function wrapKey(wrappingKey: Uint8Array, key: Uint8Array, aad: string): string {
	return seal(wrappingKey, key, aad)
}

export function unwrapKey(wrappingKey: Uint8Array, wrapped: string, aad: string): Uint8Array {
	const key = open(wrappingKey, wrapped, aad)
	if (key.length !== KEY_BYTES) {
		throw new DecryptionError('Unwrapped key has the wrong length')
	}
	return key
}

/** Best-effort zeroing of key material that is no longer needed. */
export function wipe(...keys: (Uint8Array | null | undefined)[]): void {
	for (const key of keys) {
		if (key) {
			na().memzero(key)
		}
	}
}
