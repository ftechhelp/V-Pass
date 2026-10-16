import { DecryptionError, InvalidRecoveryKeyError, WrongPasswordError } from './errors.ts'
import { type KdfParams, deriveMasterKey, newKdfParams } from './kdf.ts'
import { AAD, KDF_CONTEXT, deriveSubkey, generateKey, unwrapKey, wipe, wrapKey } from './keys.ts'
import { generateRecoveryKey, parseRecoveryKey } from './recovery.ts'

/**
 * Key hierarchy
 *
 *   master password ──Argon2id──▶ master key ──KDF──▶ KEK ──wraps──▶ Vault Key (VK)
 *   recovery key ─────────────────────────────KDF──▶ RK  ──wraps──▶ VK
 *   passkey PRF output ───────────────────────KDF──▶ PK  ──wraps──▶ VK
 *   VK ──wraps──▶ per-item / per-folder keys ──encrypt──▶ item payloads
 *
 * Only wrapped keys and ciphertext ever reach the server.
 */
export interface VaultKeyset {
	kdf: KdfParams
	/** VK wrapped by the key-encryption key derived from the master password. */
	wrappedVaultKey: string
	/** VK wrapped by the key derived from the recovery key. */
	recoveryWrappedVaultKey: string
}

export interface NewVault {
	keyset: VaultKeyset
	vaultKey: Uint8Array
	/** Show once to the user; never stored anywhere by V-Pass. */
	recoveryKey: string
}

function passwordWrappingKey(password: string, kdf: KdfParams): Uint8Array {
	const masterKey = deriveMasterKey(password, kdf)
	try {
		return deriveSubkey(masterKey, KDF_CONTEXT.keyEncryptionKey)
	} finally {
		wipe(masterKey)
	}
}

export function createVaultKeys(masterPassword: string, kdf: KdfParams = newKdfParams()): NewVault {
	const vaultKey = generateKey()
	const kek = passwordWrappingKey(masterPassword, kdf)
	const recovery = rotateRecoveryKey(vaultKey)
	const keyset: VaultKeyset = {
		kdf,
		wrappedVaultKey: wrapKey(kek, vaultKey, AAD.vaultKeyPassword),
		recoveryWrappedVaultKey: recovery.recoveryWrappedVaultKey,
	}
	wipe(kek)
	return { keyset, vaultKey, recoveryKey: recovery.recoveryKey }
}

export function unlockWithPassword(password: string, keyset: Pick<VaultKeyset, 'kdf' | 'wrappedVaultKey'>): Uint8Array {
	const kek = passwordWrappingKey(password, keyset.kdf)
	try {
		return unwrapKey(kek, keyset.wrappedVaultKey, AAD.vaultKeyPassword)
	} catch (e) {
		if (e instanceof DecryptionError) {
			throw new WrongPasswordError()
		}
		throw e
	} finally {
		wipe(kek)
	}
}

export function unlockWithRecoveryKey(recoveryKey: string, keyset: Pick<VaultKeyset, 'recoveryWrappedVaultKey'>): Uint8Array {
	const secret = parseRecoveryKey(recoveryKey)
	const rk = deriveSubkey(secret, KDF_CONTEXT.recovery)
	try {
		return unwrapKey(rk, keyset.recoveryWrappedVaultKey, AAD.vaultKeyRecovery)
	} catch (e) {
		if (e instanceof DecryptionError) {
			throw new InvalidRecoveryKeyError('mismatch')
		}
		throw e
	} finally {
		wipe(secret, rk)
	}
}

/** Re-wrap the (unchanged) vault key under a new master password. Items are untouched. */
export function rewrapWithPassword(vaultKey: Uint8Array, newPassword: string, kdf: KdfParams = newKdfParams()): Pick<VaultKeyset, 'kdf' | 'wrappedVaultKey'> {
	const kek = passwordWrappingKey(newPassword, kdf)
	try {
		return { kdf, wrappedVaultKey: wrapKey(kek, vaultKey, AAD.vaultKeyPassword) }
	} finally {
		wipe(kek)
	}
}

/** Issue a fresh recovery key; the previous one stops working once the server stores the new wrap. */
export function rotateRecoveryKey(vaultKey: Uint8Array): { recoveryKey: string, recoveryWrappedVaultKey: string } {
	const { secret, formatted } = generateRecoveryKey()
	const rk = deriveSubkey(secret, KDF_CONTEXT.recovery)
	try {
		return { recoveryKey: formatted, recoveryWrappedVaultKey: wrapKey(rk, vaultKey, AAD.vaultKeyRecovery) }
	} finally {
		wipe(secret, rk)
	}
}
