import { matchLogins } from '@vpass/core'
import { isUnlocked } from './session.ts'
import { activeItems } from './vault.ts'

/** Toolbar icon (grey when locked) and per-tab badge with the number of matching logins. */

const icon = (state: 'locked' | 'unlocked') => ({ 16: `/icons/${state}-16.png`, 32: `/icons/${state}-32.png` })

export async function refreshBadge(tabId?: number): Promise<void> {
	const unlocked = await isUnlocked()
	await chrome.action.setIcon({ path: icon(unlocked ? 'unlocked' : 'locked') })
	await chrome.action.setBadgeBackgroundColor({ color: '#0082c9' })
	const tabs = tabId !== undefined
		? [await chrome.tabs.get(tabId).catch(() => null)].filter((t): t is chrome.tabs.Tab => t !== null)
		: await chrome.tabs.query({ active: true })
	if (!unlocked) {
		await Promise.all(tabs.map((tab) => chrome.action.setBadgeText({ tabId: tab.id, text: '' })))
		await chrome.action.setTitle({ title: 'V-Pass (locked)' })
		return
	}
	await chrome.action.setTitle({ title: 'V-Pass' })
	let items: Awaited<ReturnType<typeof activeItems>> = []
	try {
		items = await activeItems()
	} catch {
		return
	}
	await Promise.all(tabs.map((tab) => {
		const count = tab.url ? matchLogins(items, tab.url).length : 0
		return chrome.action.setBadgeText({ tabId: tab.id, text: count ? String(count) : '' })
	}))
}
