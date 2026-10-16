import type { VaultCacheJSON, VaultMeta } from '@vpass/core'
import type { Settings } from '../shared/settings.ts'

/**
 * Typed access to extension storage.
 *
 * - `local` (disk): account + app password, settings, the *encrypted* vault cache,
 *   and the vault key only when the user opted into "keep unlocked".
 * - `session` (memory, cleared when Chrome closes, trusted contexts only): the
 *   vault key and short-lived state that must survive service-worker restarts.
 */

export interface Account {
	/** Nextcloud base URL as returned by Login Flow v2, without trailing slash. */
	server: string
	loginName: string
	appPassword: string
}

export interface LocalData {
	account: Account
	vaultMeta: VaultMeta
	cache: VaultCacheJSON
	settings: Partial<Settings>
	neverSave: string[]
	/** The user's last choice for the "keep unlocked" checkbox. */
	keepUnlocked: boolean
	/** base64url vault key; present only while "keep unlocked" is on. */
	persistedVaultKey: string
	lastSync: number
	syncError: string | null
}

export interface SessionData {
	/** base64url vault key while unlocked. */
	vaultKey: string
	[key: `map:${string}`]: Record<string, unknown>
}

function area<T extends object>(storage: chrome.storage.StorageArea) {
	return {
		async get<K extends keyof T & string>(key: K): Promise<T[K] | undefined> {
			const result = await storage.get(key)
			return result[key] as T[K] | undefined
		},
		set(patch: Partial<T>): Promise<void> {
			return storage.set(patch)
		},
		remove(...keys: (keyof T & string)[]): Promise<void> {
			return storage.remove(keys)
		},
		clear(): Promise<void> {
			return storage.clear()
		},
	}
}

export const local = area<LocalData>(chrome.storage.local)
export const session = area<SessionData>(chrome.storage.session)

/**
 * A string-keyed map mirrored to chrome.storage.session, for state that must
 * survive the service worker being stopped (pending prompts, frame registry…).
 * Loaded once per worker lifetime; every mutation is written through in order.
 */
export class SessionMap<V> {
	private data: Map<string, V> | null = null
	private loading: Promise<Map<string, V>> | null = null
	private writing: Promise<void> = Promise.resolve()

	constructor(private readonly name: string) {}

	private load(): Promise<Map<string, V>> {
		if (this.data) {
			return Promise.resolve(this.data)
		}
		this.loading ??= session.get(`map:${this.name}`).then((stored) => {
			this.data = new Map(Object.entries((stored ?? {}) as Record<string, V>))
			return this.data
		})
		return this.loading
	}

	private persist(map: Map<string, V>): Promise<void> {
		const snapshot = Object.fromEntries(map) as Record<string, unknown>
		this.writing = this.writing.then(() => session.set({ [`map:${this.name}`]: snapshot }))
		return this.writing
	}

	async get(key: string): Promise<V | undefined> {
		return (await this.load()).get(key)
	}

	async entries(): Promise<[string, V][]> {
		return [...(await this.load()).entries()]
	}

	async set(key: string, value: V): Promise<void> {
		const map = await this.load()
		map.set(key, value)
		await this.persist(map)
	}

	async delete(key: string): Promise<void> {
		const map = await this.load()
		if (map.delete(key)) {
			await this.persist(map)
		}
	}

	/** Remove every entry for which `predicate` is true. */
	async deleteWhere(predicate: (value: V, key: string) => boolean): Promise<void> {
		const map = await this.load()
		let changed = false
		for (const [key, value] of map) {
			if (predicate(value, key)) {
				map.delete(key)
				changed = true
			}
		}
		if (changed) {
			await this.persist(map)
		}
	}

	async clear(): Promise<void> {
		const map = await this.load()
		map.clear()
		await this.persist(map)
	}
}

/** Random URL-safe token for binding iframes and prompts to a tab. */
export function newToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(18))
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_')
}
