import {
	type CardItem,
	type DecryptedItem,
	type IdentityItem,
	type LoginItem,
	cardBrand,
	fullName,
	generatePassphrase,
	generatePassword,
	hostnameOf,
	itemSubtitle,
	matchLogins,
	matchUrl,
	parseTotp,
	passkeyMatchesRequest,
	resolveRpId,
	totpCode,
} from '@vpass/core'
import type {
	ConditionalRequest,
	ContentCommand,
	FieldKind,
	FillPayload,
	FrameForms,
	InlineChoice,
	InlineView,
	SiteView,
	TotpView,
} from '../shared/protocol.ts'
import { getSettings } from './settings.ts'
import { isUnlocked } from './session.ts'
import { SessionMap, newToken } from './storage.ts'
import { activeItems, findItem } from './vault.ts'

/* ---------- frames ---------- */

interface FrameInfo {
	url: string
	origin: string
	forms: FrameForms
}

/** tabId → frameId → what that frame's content script found. */
const frames = new SessionMap<Record<string, FrameInfo>>('frames')

/** The URL to match logins against: the frame URL, or its origin for about:blank / srcdoc frames. */
export function pageUrlOf(sender: chrome.runtime.MessageSender): string | null {
	const url = sender.url ?? ''
	if (/^https?:/i.test(url)) {
		return url
	}
	return sender.origin && /^https?:/i.test(sender.origin) ? sender.origin : null
}

export function originOf(sender: chrome.runtime.MessageSender): string | null {
	const url = pageUrlOf(sender)
	return url ? new URL(url).origin : null
}

export async function registerFrame(sender: chrome.runtime.MessageSender, forms: FrameForms): Promise<number> {
	const tabId = sender.tab?.id
	const url = pageUrlOf(sender)
	if (tabId === undefined || sender.frameId === undefined || !url) {
		return 0
	}
	const tabFrames = (await frames.get(String(tabId))) ?? {}
	tabFrames[String(sender.frameId)] = { url, origin: new URL(url).origin, forms }
	await frames.set(String(tabId), tabFrames)
	if (!(await isUnlocked())) {
		return 0
	}
	return matchLogins(await activeItems(), url).length
}

export async function forgetTab(tabId: number): Promise<void> {
	await frames.delete(String(tabId))
	await inlineTokens.deleteWhere((t) => t.tabId === tabId)
	await grants.deleteWhere((g) => g.tabId === tabId)
}

/** A top-level navigation replaces every frame of the tab. */
export async function forgetTabFrames(tabId: number): Promise<void> {
	await frames.delete(String(tabId))
}

async function tabFrames(tabId: number): Promise<[number, FrameInfo][]> {
	const stored = (await frames.get(String(tabId))) ?? {}
	return Object.entries(stored)
		.map(([id, info]) => [Number(id), info] as [number, FrameInfo])
		.sort(([a], [b]) => a - b)
}

export async function activeTab(): Promise<chrome.tabs.Tab | null> {
	const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
	return tab ?? null
}

async function sendToFrame(tabId: number, frameId: number, command: ContentCommand): Promise<unknown> {
	try {
		return await chrome.tabs.sendMessage(tabId, command, { frameId })
	} catch {
		return undefined
	}
}

/* ---------- payloads ---------- */

async function currentTotp(item: LoginItem): Promise<string | undefined> {
	if (!item.totp) {
		return undefined
	}
	try {
		return (await totpCode(parseTotp(item.totp))).code
	} catch {
		return undefined
	}
}

export async function totpFor(itemId: string): Promise<TotpView> {
	const entry = await findItem(itemId)
	if (entry?.item.type !== 'login' || !entry.item.totp) {
		throw new Error('This item has no one-time code')
	}
	return totpCode(parseTotp(entry.item.totp))
}

function compact<T extends Record<string, string>>(values: T): Partial<T> {
	return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '')) as Partial<T>
}

export function cardPayload(card: CardItem): FillPayload['card'] {
	const month = card.expMonth ? card.expMonth.padStart(2, '0') : ''
	const year = card.expYear
	return compact({
		'cc-name': card.cardholderName,
		'cc-number': card.number.replace(/[\s-]/g, ''),
		'cc-exp-month': month,
		'cc-exp-year': year,
		'cc-exp': month && year ? `${month}/${year.slice(-2)}` : '',
		'cc-csc': card.cvc,
		'cc-type': cardBrand(card.number) === 'unknown' ? '' : cardBrand(card.number),
	})
}

export function identityPayload(identity: IdentityItem): FillPayload['identity'] {
	return compact({
		'name': fullName(identity),
		'given-name': identity.firstName,
		'additional-name': identity.middleName,
		'family-name': identity.lastName,
		'email': identity.email,
		'tel': identity.phone,
		'organization': identity.company,
		'street-address': [identity.address1, identity.address2].filter(Boolean).join('\n'),
		'address-line1': identity.address1,
		'address-line2': identity.address2,
		'address-level2': identity.city,
		'address-level1': identity.state,
		'postal-code': identity.zip,
		'country': identity.country,
		'country-name': identity.country,
		'bday': identity.birthday,
	})
}

async function loginPayload(item: LoginItem): Promise<FillPayload> {
	return { username: item.username, password: item.password, totp: await currentTotp(item) }
}

export async function generateFromSettings(): Promise<string> {
	const { generator } = await getSettings()
	return generator.mode === 'passphrase' ? generatePassphrase(generator.passphrase) : generatePassword(generator.password)
}

/* ---------- popup / shortcut fills ---------- */

export async function siteView(): Promise<SiteView> {
	const tab = await activeTab()
	const url = tab?.url && /^https?:/i.test(tab.url) ? tab.url : null
	if (!tab?.id || !url) {
		return { url: null, host: null, logins: [], hasCardFields: false, hasIdentityFields: false }
	}
	const found = await tabFrames(tab.id)
	return {
		url,
		host: new URL(url).host,
		logins: matchLogins(await activeItems(), url).map((m) => ({ id: m.entry.id, insecure: m.insecure })),
		hasCardFields: found.some(([, f]) => f.forms.card),
		hasIdentityFields: found.some(([, f]) => f.forms.identity),
	}
}

/**
 * Fill an item into the active tab. Logins go to one frame whose URL matches
 * the login (top frame first); without such a frame the caller must confirm
 * (`force`). Cards and identities go to every frame with matching fields, since
 * payment fields often live in the payment provider's iframe.
 */
export async function fillItem(itemId: string, force = false): Promise<{ filled: boolean, reason?: string }> {
	const tab = await activeTab()
	const entry = await findItem(itemId)
	if (!tab?.id || !entry) {
		return { filled: false, reason: 'Nothing to fill here' }
	}
	const found = await tabFrames(tab.id)
	const item = entry.item
	if (item.type === 'login') {
		const candidates = found.filter(([, f]) => f.forms.login || f.forms.newPassword || f.forms.totp)
		if (candidates.length === 0) {
			return { filled: false, reason: 'No login form found on this page' }
		}
		const matching = candidates.filter(([, f]) => item.urls.some((u) => matchUrl(u, f.url)))
		const secure = matching.filter(([, f]) => item.urls.some((u) => matchUrl(u, f.url)?.insecure === false))
		const target = (secure[0] ?? (force ? matching[0] ?? candidates[0] : undefined))
		if (!target) {
			const page = hostnameOf(candidates[0]![1].url)
			const saved = item.urls[0] ? hostnameOf(item.urls[0]) : null
			return {
				filled: false,
				reason: matching.length
					? `${page} is not using a secure connection. Fill anyway?`
					: saved ? `This login is saved for ${saved}, not ${page}. Fill anyway?` : `This login has no website. Fill it on ${page}?`,
			}
		}
		const filled = await sendToFrame(tab.id, target[0], { type: 'fill', payload: await loginPayload(item), fieldKind: null })
		return { filled: Boolean((filled as { filled?: boolean } | undefined)?.filled) }
	}
	if (item.type === 'card' || item.type === 'identity') {
		const key = item.type === 'card' ? 'card' : 'identity'
		const payload: FillPayload = item.type === 'card' ? { card: cardPayload(item) } : { identity: identityPayload(item) }
		const withFields = found.filter(([, f]) => f.forms[key])
		// The page's own frames first; a third-party frame (payment provider, or an ad
		// pretending to be one) only gets the data after the user confirms.
		const topOrigin = tab.url ? new URL(tab.url).origin : null
		const sameOrigin = withFields.filter(([, f]) => f.origin === topOrigin)
		if (!sameOrigin.length && withFields.length && !force) {
			const hosts = [...new Set(withFields.map(([, f]) => new URL(f.url).host))].join(', ')
			return { filled: false, reason: `These ${item.type === 'card' ? 'card' : 'address'} fields belong to ${hosts}, not ${tab.url ? new URL(tab.url).host : 'this page'}. Fill them anyway?` }
		}
		const targets = sameOrigin.length ? sameOrigin : withFields
		const results = await Promise.all(targets.map(([frameId]) => sendToFrame(tab.id!, frameId, { type: 'fill', payload, fieldKind: key })))
		const filled = results.some((r) => (r as { filled?: boolean } | undefined)?.filled)
		return filled ? { filled } : { filled: false, reason: `No ${item.type === 'card' ? 'payment card' : 'address'} fields found on this page` }
	}
	return { filled: false, reason: 'Notes cannot be filled' }
}

/** Keyboard shortcut / context menu: fill the best secure match. */
export async function fillBestLogin(): Promise<boolean> {
	const tab = await activeTab()
	if (!tab?.url) {
		return false
	}
	const best = matchLogins(await activeItems(), tab.url).find((m) => !m.insecure)
	if (!best) {
		return false
	}
	return (await fillItem(best.entry.id)).filled
}

/** Fill a fresh password into the focused new-password field, if any. */
export async function fillGeneratedIntoFocused(password: string): Promise<boolean> {
	const tab = await activeTab()
	if (!tab?.id) {
		return false
	}
	const results = await Promise.all((await tabFrames(tab.id)).map(([frameId]) =>
		sendToFrame(tab.id!, frameId, { type: 'fill', payload: { newPassword: password }, fieldKind: 'new-password' })))
	return results.some((r) => (r as { filled?: boolean } | undefined)?.filled)
}

/* ---------- inline menu ---------- */

interface InlineToken {
	tabId: number
	frameId: number
	url: string
	origin: string
	fieldKind: FieldKind
	conditional: ConditionalRequest | null
	expires: number
}

const inlineTokens = new SessionMap<InlineToken>('inline')

interface Grant {
	tabId: number
	frameId: number
	credentialId: string
	expires: number
}

/** One-time permissions for a frame to get an assertion the user picked in the inline menu. */
const grants = new SessionMap<Grant>('grants')

export async function openInline(sender: chrome.runtime.MessageSender, fieldKind: FieldKind, conditional: ConditionalRequest | null): Promise<{ token: string, url: string }> {
	const tabId = sender.tab?.id
	const url = pageUrlOf(sender)
	if (tabId === undefined || sender.frameId === undefined || !url) {
		throw new Error('V-Pass cannot fill this frame')
	}
	const now = Date.now()
	await inlineTokens.deleteWhere((t) => t.expires < now || (t.tabId === tabId && t.frameId === sender.frameId))
	const token = newToken()
	await inlineTokens.set(token, { tabId, frameId: sender.frameId, url, origin: new URL(url).origin, fieldKind, conditional, expires: now + 10 * 60_000 })
	return { token, url: `${chrome.runtime.getURL('inline-menu/index.html')}#${token}` }
}

/** The iframe must live in the same tab as the frame that opened it. */
async function tokenFor(token: string, sender: chrome.runtime.MessageSender): Promise<InlineToken> {
	const entry = await inlineTokens.get(token)
	if (!entry || entry.expires < Date.now() || sender.tab?.id !== entry.tabId) {
		throw new Error('This menu has expired')
	}
	return entry
}

function loginEntry(entry: DecryptedItem) {
	return { id: entry.id, title: entry.item.title || '(untitled)', subtitle: itemSubtitle(entry.item) }
}

export async function inlineData(token: string, sender: chrome.runtime.MessageSender): Promise<InlineView> {
	const t = await tokenFor(token, sender)
	const view: InlineView = {
		locked: true,
		fieldKind: t.fieldKind,
		host: new URL(t.url).host,
		logins: [],
		passkeys: [],
		cards: [],
		identities: [],
		canGenerate: t.fieldKind === 'new-password',
	}
	if (!(await isUnlocked())) {
		return view
	}
	view.locked = false
	const items = await activeItems()
	const logins = matchLogins(items, t.url).filter((m) => !m.insecure).map((m) => m.entry)
	if (t.fieldKind === 'totp') {
		view.logins = logins.filter((e) => e.item.type === 'login' && e.item.totp).map(loginEntry)
	} else if (t.fieldKind === 'card') {
		view.cards = items.filter((e) => e.item.type === 'card').map(loginEntry)
	} else if (t.fieldKind === 'identity') {
		view.identities = items.filter((e) => e.item.type === 'identity').map(loginEntry)
	} else {
		view.logins = logins.map(loginEntry)
	}
	if (t.conditional) {
		let rpId: string | null = null
		try {
			rpId = resolveRpId(t.origin, t.conditional.rpId)
		} catch {
			rpId = null
		}
		if (rpId) {
			const allow = t.conditional.allowCredentials
			view.passkeys = items.flatMap((e) => e.item.type !== 'login' ? [] : e.item.passkeys
				.filter((pk) => passkeyMatchesRequest(pk, rpId!, allow))
				.map((pk) => ({
					id: e.id,
					credentialId: pk.credentialId,
					title: e.item.title || pk.rpName || pk.rpId,
					subtitle: pk.userName || (e.item.type === 'login' ? e.item.username : ''),
				})))
		}
	}
	return view
}

export async function inlineChoose(token: string, choice: InlineChoice, sender: chrome.runtime.MessageSender): Promise<void> {
	const t = await tokenFor(token, sender)
	if (choice.kind === 'unlock') {
		await openUnlock()
		return
	}
	if (choice.kind === 'generate') {
		await sendToFrame(t.tabId, t.frameId, { type: 'fill', payload: { newPassword: await generateFromSettings() }, fieldKind: 'new-password' })
	} else if (choice.kind === 'passkey') {
		const entry = await findItem(choice.id)
		const passkey = entry?.item.type === 'login' ? entry.item.passkeys.find((pk) => pk.credentialId === choice.credentialId) : undefined
		if (!passkey) {
			throw new Error('This passkey no longer exists')
		}
		await grants.set(`${t.tabId}:${t.frameId}:${choice.credentialId}`, { tabId: t.tabId, frameId: t.frameId, credentialId: choice.credentialId, expires: Date.now() + 60_000 })
		await sendToFrame(t.tabId, t.frameId, { type: 'passkeyChosen', credentialId: choice.credentialId })
	} else {
		const entry = await findItem(choice.id)
		if (!entry) {
			throw new Error('This item no longer exists')
		}
		const item = entry.item
		let payload: FillPayload | null = null
		if (item.type === 'login' && item.urls.some((u) => matchUrl(u, t.url)?.insecure === false)) {
			payload = t.fieldKind === 'totp' ? { totp: await currentTotp(item) } : await loginPayload(item)
		} else if (item.type === 'card') {
			payload = { card: cardPayload(item) }
		} else if (item.type === 'identity') {
			payload = { identity: identityPayload(item) }
		}
		if (!payload) {
			throw new Error('This item does not belong to this site')
		}
		await sendToFrame(t.tabId, t.frameId, { type: 'fill', payload, fieldKind: t.fieldKind })
	}
	await closeInline(token, sender)
}

export async function closeInline(token: string, sender: chrome.runtime.MessageSender): Promise<void> {
	const t = await tokenFor(token, sender)
	await inlineTokens.delete(token)
	await sendToFrame(t.tabId, t.frameId, { type: 'closeInline' })
}

/** Consume the grant the inline menu created for a conditional passkey sign-in. */
export async function consumeGrant(sender: chrome.runtime.MessageSender, credentialId: string): Promise<boolean> {
	const key = `${sender.tab?.id}:${sender.frameId}:${credentialId}`
	const grant = await grants.get(key)
	await grants.delete(key)
	return Boolean(grant && grant.expires > Date.now())
}

/** Show the unlock screen: the toolbar popup when Chrome allows it, else a small window. */
export async function openUnlock(): Promise<void> {
	try {
		await chrome.action.openPopup()
	} catch {
		await chrome.windows.create({ url: chrome.runtime.getURL('prompt/index.html#unlock'), type: 'popup', width: 420, height: 560, focused: true })
	}
}
