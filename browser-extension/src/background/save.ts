import { type DecryptedItem, matchLogins, newItem, registrableDomain } from '@vpass/core'
import type { SaveBarAction, SaveBarView } from '../shared/protocol.ts'
import { pageUrlOf } from './autofill.ts'
import { isUnlocked } from './session.ts'
import { addNeverSave, getSettings, neverSaveList } from './settings.ts'
import { SessionMap, newToken } from './storage.ts'
import { activeItems, createItem, modifyItem } from './vault.ts'

/**
 * "Save login?" / "Update password?" prompts. Content scripts report submitted
 * credentials; the prompt is kept per tab for a few minutes so it can still be
 * shown after the site navigates away from its login page.
 */

interface PendingSave {
	token: string
	tabId: number
	kind: 'new' | 'update'
	origin: string
	host: string
	username: string
	password: string
	itemId: string | null
	itemTitle: string | null
	expires: number
}

const pending = new SessionMap<PendingSave>('saves')
const PROMPT_TTL = 5 * 60_000

function barUrl(token: string): string {
	return `${chrome.runtime.getURL('notification-bar/index.html')}#${token}`
}

async function show(save: PendingSave): Promise<void> {
	try {
		await chrome.tabs.sendMessage(save.tabId, { type: 'showSaveBar', token: save.token, url: barUrl(save.token) }, { frameId: 0 })
	} catch {
		// The page is navigating; its next content script asks for the prompt (pendingSaveBar).
	}
}

const sameUser = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Decide whether submitted credentials are new, a password change, or already saved. */
export function classifySubmission(logins: DecryptedItem[], username: string, password: string, newPassword: string | null): { kind: 'new' | 'update', existing: DecryptedItem | null } | null {
	const secret = newPassword || password
	if (!secret) {
		return null
	}
	const isLogin = (e: DecryptedItem) => e.item.type === 'login'
	const candidates = logins.filter(isLogin)
	let existing = username ? candidates.find((e) => e.item.type === 'login' && sameUser(e.item.username, username)) : undefined
	if (!existing && newPassword && password) {
		// Change-password form: the current password identifies the login.
		existing = candidates.find((e) => e.item.type === 'login' && e.item.password === password)
	}
	if (!existing && !username && candidates.length === 1) {
		// Password-only step of a two-step login.
		existing = candidates[0]
	}
	if (existing?.item.type === 'login' && existing.item.password === secret) {
		return null
	}
	return { kind: existing ? 'update' : 'new', existing: existing ?? null }
}

export async function submitted(sender: chrome.runtime.MessageSender, username: string, password: string, newPassword: string | null): Promise<void> {
	const tabId = sender.tab?.id
	const url = pageUrlOf(sender)
	if (tabId === undefined || !url || !(await getSettings()).offerToSave || !(await isUnlocked())) {
		return
	}
	const { hostname, origin, host } = new URL(url)
	const never = await neverSaveList()
	if (never.includes(hostname) || never.includes(registrableDomain(hostname))) {
		return
	}
	const matches = matchLogins(await activeItems(), url).filter((m) => !m.insecure).map((m) => m.entry)
	const decision = classifySubmission(matches, username, password, newPassword)
	if (!decision) {
		return
	}
	const save: PendingSave = {
		token: newToken(),
		tabId,
		kind: decision.kind,
		origin,
		host,
		username: decision.existing?.item.type === 'login' && !username ? decision.existing.item.username : username,
		password: newPassword || password,
		itemId: decision.existing?.id ?? null,
		itemTitle: decision.existing?.item.title ?? null,
		expires: Date.now() + PROMPT_TTL,
	}
	await pending.set(String(tabId), save)
	await show(save)
}

/** Asked by a freshly loaded top frame: is there a prompt to show in this tab? */
export async function pendingBar(sender: chrome.runtime.MessageSender): Promise<{ token: string, url: string } | null> {
	if (sender.frameId !== 0 || sender.tab?.id === undefined) {
		return null
	}
	const save = await pending.get(String(sender.tab.id))
	if (!save || save.expires < Date.now()) {
		return null
	}
	return { token: save.token, url: barUrl(save.token) }
}

async function byToken(token: string, sender: chrome.runtime.MessageSender): Promise<PendingSave> {
	const save = sender.tab?.id !== undefined ? await pending.get(String(sender.tab.id)) : undefined
	if (!save || save.token !== token || save.expires < Date.now()) {
		throw new Error('This prompt has expired')
	}
	return save
}

export async function barView(token: string, sender: chrome.runtime.MessageSender): Promise<SaveBarView> {
	const save = await byToken(token, sender)
	return { kind: save.kind, host: save.host, username: save.username, itemTitle: save.itemTitle }
}

export async function barRespond(token: string, action: SaveBarAction, sender: chrome.runtime.MessageSender): Promise<void> {
	const save = await byToken(token, sender)
	if (action === 'save') {
		if (save.kind === 'update' && save.itemId) {
			const updated = await modifyItem(save.itemId, (item) => item.type === 'login' ? { ...item, password: save.password } : null)
			if (updated.item.type !== 'login' || updated.item.password !== save.password) {
				throw new Error('The login could not be updated')
			}
		} else {
			const title = new URL(save.origin).hostname.replace(/^www\./, '')
			await createItem(newItem('login', { title, username: save.username, password: save.password, urls: [save.origin] }))
		}
	} else if (action === 'never') {
		await addNeverSave(new URL(save.origin).hostname)
	}
	await pending.delete(String(save.tabId))
	try {
		await chrome.tabs.sendMessage(save.tabId, { type: 'closeSaveBar' }, { frameId: 0 })
	} catch {
		// tab gone
	}
}

export async function forgetTabSaves(tabId: number): Promise<void> {
	await pending.delete(String(tabId))
}
