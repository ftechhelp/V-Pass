import { type Settings, withDefaults } from '../shared/settings.ts'
import { local } from './storage.ts'

let cached: Settings | null = null
const listeners: ((settings: Settings) => void)[] = []

export function onSettingsChange(listener: (settings: Settings) => void): void {
	listeners.push(listener)
}

export async function getSettings(): Promise<Settings> {
	cached ??= withDefaults(await local.get('settings'))
	return cached
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
	const next = withDefaults({ ...(await getSettings()), ...patch })
	next.autoLockMinutes = Math.max(0, Math.min(24 * 60, Math.floor(next.autoLockMinutes)))
	next.clipboardClearSeconds = Math.max(0, Math.min(600, Math.floor(next.clipboardClearSeconds)))
	await local.set({ settings: next })
	cached = next
	listeners.forEach((l) => l(next))
	return next
}

export async function neverSaveList(): Promise<string[]> {
	return (await local.get('neverSave')) ?? []
}

export async function addNeverSave(host: string): Promise<void> {
	const list = await neverSaveList()
	if (!list.includes(host)) {
		await local.set({ neverSave: [...list, host].sort() })
	}
}

export async function removeNeverSave(host: string): Promise<string[]> {
	const list = (await neverSaveList()).filter((h) => h !== host)
	await local.set({ neverSave: list })
	return list
}
