import { type VaultMeta, ApiError, b64urlDecode, b64urlEncode, initCrypto, unlockWithPassword, wipe } from '@vpass/core'
import { api } from './account.ts'
import { local, session } from './storage.ts'

/**
 * The vault key (VK).
 *
 * Default: kept in memory and in chrome.storage.session (memory-only, cleared
 * when Chrome closes) so the vault survives the service worker being stopped
 * but not a browser restart.
 *
 * "Keep unlocked" (opt-in, with a warning in the UI): the VK is also written to
 * chrome.storage.local so the vault stays unlocked across restarts until the
 * user locks it. Anyone with access to this Chrome profile can then read it.
 */

let vaultKey: Uint8Array | null = null
let listeners: (() => void)[] = []

export function onLockChange(listener: () => void): void {
	listeners.push(listener)
}

function notify(): void {
	listeners.forEach((l) => {
		try {
			l()
		} catch (e) {
			console.error(e)
		}
	})
}

export class NoVaultError extends Error {
	constructor() {
		super('This Nextcloud account has no V-Pass vault yet. Create it in the V-Pass web app first.')
		this.name = 'NoVaultError'
	}
}

/** The VK if unlocked (restoring it from storage after a worker restart), else null. */
export async function getVaultKey(): Promise<Uint8Array | null> {
	if (vaultKey) {
		return vaultKey
	}
	const fromSession = await session.get('vaultKey')
	if (fromSession) {
		vaultKey = b64urlDecode(fromSession)
		return vaultKey
	}
	if (await local.get('keepUnlocked')) {
		const persisted = await local.get('persistedVaultKey')
		if (persisted) {
			vaultKey = b64urlDecode(persisted)
			await session.set({ vaultKey: persisted })
			return vaultKey
		}
	}
	return null
}

export async function requireVaultKey(): Promise<Uint8Array> {
	const key = await getVaultKey()
	if (!key) {
		const error = new Error('V-Pass is locked')
		error.name = 'LockedError'
		throw error
	}
	return key
}

export async function isUnlocked(): Promise<boolean> {
	return (await getVaultKey()) !== null
}

/** Current vault metadata from the server, falling back to the cached copy when offline. */
export async function fetchVaultMeta(): Promise<VaultMeta | null> {
	try {
		const meta = await (await api()).getVault()
		if (meta) {
			await local.set({ vaultMeta: meta })
		} else {
			await local.remove('vaultMeta')
		}
		return meta
	} catch (e) {
		if (e instanceof ApiError && e.status === 401) {
			throw new Error('Nextcloud rejected V-Pass\'s app password. Disconnect and connect again.')
		}
		const cached = await local.get('vaultMeta')
		if (cached) {
			return cached
		}
		throw e
	}
}

export async function unlock(password: string, keepUnlocked: boolean): Promise<void> {
	const meta = await fetchVaultMeta()
	if (!meta) {
		throw new NoVaultError()
	}
	await initCrypto()
	// Throws WrongPasswordError for a wrong master password (Argon2id, ~1 s).
	const key = unlockWithPassword(password, meta)
	await setVaultKey(key, keepUnlocked)
}

async function setVaultKey(key: Uint8Array, keepUnlocked: boolean): Promise<void> {
	if (vaultKey && vaultKey !== key) {
		wipe(vaultKey)
	}
	vaultKey = key
	const encoded = b64urlEncode(key)
	await session.set({ vaultKey: encoded })
	if (keepUnlocked) {
		await local.set({ keepUnlocked: true, persistedVaultKey: encoded })
	} else {
		await local.set({ keepUnlocked: false })
		await local.remove('persistedVaultKey')
	}
	notify()
}

/** Turn "keep unlocked" on or off while unlocked. */
export async function setKeepUnlocked(value: boolean): Promise<void> {
	await setVaultKey(await requireVaultKey(), value)
}

export async function lock(): Promise<void> {
	wipe(vaultKey)
	vaultKey = null
	await session.remove('vaultKey')
	// Keep the user's checkbox choice, but never the key itself.
	await local.remove('persistedVaultKey')
	notify()
}

export function resetForTests(): void {
	vaultKey = null
	listeners = []
}
