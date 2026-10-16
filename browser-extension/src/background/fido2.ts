import {
	type CreationOptionsJSON,
	type DecryptedItem,
	type Passkey,
	type RequestOptionsJSON,
	WebAuthnError,
	chooseAlgorithm,
	createCredential,
	getAssertion,
	isExcluded,
	matchLogins,
	newItem,
	passkeyMatchesRequest,
	resolveRpId,
} from '@vpass/core'
import type { Fido2Decision, Fido2Details, Fido2Result } from '../shared/protocol.ts'
import { consumeGrant, originOf } from './autofill.ts'
import { isUnlocked } from './session.ts'
import { getSettings } from './settings.ts'
import { SessionMap, newToken } from './storage.ts'
import { activeItems, createItem, findItem, modifyItem } from './vault.ts'

/**
 * Passkey requests from websites. The page-world shim forwards
 * navigator.credentials.create/get here (through the content script); the user
 * decides in a small V-Pass window, and the result goes back to the frame with
 * a `fido2Result` command. Pending requests live in session storage so a
 * stopped service worker does not lose them.
 *
 * - The calling origin always comes from the browser (`sender`), never the page.
 * - Calls from cross-origin iframes are passed to the browser for now.
 * - "Use another device" hands the request back to Chrome's own UI.
 */

interface PendingRequest {
	id: string
	pageRequestId: string
	kind: 'create' | 'get'
	tabId: number
	frameId: number
	origin: string
	rpId: string
	options: CreationOptionsJSON | RequestOptionsJSON
	windowId: number | null
	expires: number
}

const pending = new SessionMap<PendingRequest>('fido2')
const REQUEST_TTL = 10 * 60_000

const fallback: Fido2Result = { status: 'fallback' }

function errorResult(e: unknown): Fido2Result {
	if (e instanceof WebAuthnError) {
		return { status: 'error', name: e.domName, message: e.message }
	}
	return { status: 'error', name: 'NotAllowedError', message: (e as Error)?.message ?? 'The request failed' }
}

const cancelled: Fido2Result = { status: 'error', name: 'NotAllowedError', message: 'The operation either timed out or was not allowed.' }

/** The calling frame, or null when V-Pass should not handle it (cross-origin iframe, opaque origin). */
function callerOf(sender: chrome.runtime.MessageSender): { tabId: number, frameId: number, origin: string } | null {
	const tabId = sender.tab?.id
	const origin = originOf(sender)
	if (tabId === undefined || sender.frameId === undefined || !origin || sender.origin !== origin) {
		return null
	}
	if (sender.frameId !== 0) {
		const top = sender.tab?.url ? new URL(sender.tab.url).origin : null
		if (top !== origin) {
			return null
		}
	}
	return { tabId, frameId: sender.frameId, origin }
}

interface FoundPasskey {
	entry: DecryptedItem
	passkey: Passkey
}

function passkeysFor(items: DecryptedItem[], rpId: string, options: RequestOptionsJSON): FoundPasskey[] {
	return items.flatMap((entry) => entry.item.type !== 'login'
		? []
		: entry.item.passkeys.filter((pk) => passkeyMatchesRequest(pk, rpId, options.allowCredentials)).map((passkey) => ({ entry, passkey })))
}

function allPasskeys(items: DecryptedItem[]): Passkey[] {
	return items.flatMap((e) => e.item.type === 'login' ? e.item.passkeys : [])
}

async function openPrompt(request: PendingRequest, sender: chrome.runtime.MessageSender): Promise<void> {
	const width = 440
	const height = 620
	let position: { left?: number, top?: number } = {}
	try {
		const win = sender.tab?.windowId !== undefined ? await chrome.windows.get(sender.tab.windowId) : null
		if (win?.left !== undefined && win.width !== undefined && win.top !== undefined) {
			position = { left: Math.round(win.left + (win.width - width) / 2), top: win.top + 80 }
		}
	} catch {
		// default position
	}
	const created = await chrome.windows.create({ url: chrome.runtime.getURL(`prompt/index.html#${request.id}`), type: 'popup', width, height, focused: true, ...position })
	request.windowId = created?.id ?? null
	await pending.set(request.id, request)
}

async function enqueue(kind: 'create' | 'get', sender: chrome.runtime.MessageSender, caller: { tabId: number, frameId: number, origin: string }, pageRequestId: string, rpId: string, options: CreationOptionsJSON | RequestOptionsJSON): Promise<{ status: 'pending' }> {
	const now = Date.now()
	// One request per frame: a new one replaces (and closes) the previous prompt.
	for (const [, old] of await pending.entries()) {
		if (old.expires < now || (old.tabId === caller.tabId && old.frameId === caller.frameId)) {
			await finish(old, cancelled)
		}
	}
	const request: PendingRequest = { id: newToken(), pageRequestId, kind, ...caller, rpId, options, windowId: null, expires: now + REQUEST_TTL }
	await pending.set(request.id, request)
	await openPrompt(request, sender)
	return { status: 'pending' }
}

export async function handleCreate(sender: chrome.runtime.MessageSender, pageRequestId: string, options: CreationOptionsJSON): Promise<{ status: 'pending' } | Fido2Result> {
	const caller = callerOf(sender)
	if (!caller || !(await getSettings()).passkeyProvider) {
		return fallback
	}
	let rpId: string
	try {
		rpId = resolveRpId(caller.origin, options.rp?.id)
	} catch (e) {
		return errorResult(e)
	}
	if (chooseAlgorithm(options.pubKeyCredParams) === null) {
		return fallback
	}
	return enqueue('create', sender, caller, pageRequestId, rpId, options)
}

export async function handleGet(sender: chrome.runtime.MessageSender, pageRequestId: string, options: RequestOptionsJSON, credentialId: string | null): Promise<{ status: 'pending' } | Fido2Result> {
	const caller = callerOf(sender)
	if (!caller || !(await getSettings()).passkeyProvider) {
		return fallback
	}
	let rpId: string
	try {
		rpId = resolveRpId(caller.origin, options.rpId)
	} catch (e) {
		return errorResult(e)
	}
	if (credentialId !== null) {
		// Passkey autofill: the user already picked this passkey in the inline menu.
		if (!(await consumeGrant(sender, credentialId)) || !(await isUnlocked())) {
			return cancelled
		}
		const found = passkeysFor(await activeItems(), rpId, options).find((f) => f.passkey.credentialId === credentialId)
		if (!found) {
			return cancelled
		}
		try {
			return { status: 'ok', response: await getAssertion(options, found.passkey, { origin: caller.origin }) }
		} catch (e) {
			return errorResult(e)
		}
	}
	if (await isUnlocked()) {
		if (passkeysFor(await activeItems(), rpId, options).length === 0) {
			return fallback
		}
	}
	return enqueue('get', sender, caller, pageRequestId, rpId, options)
}

export async function details(id: string): Promise<Fido2Details> {
	const request = await pending.get(id)
	if (!request || request.expires < Date.now()) {
		throw new Error('This request has expired')
	}
	const locked = !(await isUnlocked())
	const base = { kind: request.kind, origin: request.origin, rpId: request.rpId, locked, candidates: [], excluded: false }
	if (request.kind === 'create') {
		const options = request.options as CreationOptionsJSON
		const view: Fido2Details = { ...base, rpName: options.rp?.name || request.rpId, userName: options.user?.name ?? '' }
		if (!locked) {
			const items = await activeItems()
			view.excluded = isExcluded(allPasskeys(items), request.rpId, options.excludeCredentials)
			view.candidates = matchLogins(items, request.origin)
				.filter((m) => !m.insecure)
				.map((m) => m.entry)
				.sort((a, b) => Number(b.item.type === 'login' && b.item.username === view.userName) - Number(a.item.type === 'login' && a.item.username === view.userName))
				.map((e) => ({ id: e.id, title: e.item.title, username: e.item.type === 'login' ? e.item.username : '' }))
		}
		return view
	}
	const view: Fido2Details = { ...base, rpName: request.rpId, userName: '' }
	if (!locked) {
		const found = passkeysFor(await activeItems(), request.rpId, request.options as RequestOptionsJSON)
		view.rpName = found[0]?.passkey.rpName || request.rpId
		view.candidates = found.map(({ entry, passkey }) => ({
			id: entry.id,
			title: entry.item.title || passkey.rpName || passkey.rpId,
			username: passkey.userName || (entry.item.type === 'login' ? entry.item.username : ''),
			credentialId: passkey.credentialId,
		}))
	}
	return view
}

async function finish(request: PendingRequest, result: Fido2Result): Promise<void> {
	await pending.delete(request.id)
	try {
		await chrome.tabs.sendMessage(request.tabId, { type: 'fido2Result', requestId: request.pageRequestId, result }, { frameId: request.frameId })
	} catch {
		// The page went away.
	}
	if (request.windowId !== null) {
		chrome.windows.remove(request.windowId).catch(() => {})
	}
}

export async function decide(id: string, decision: Fido2Decision): Promise<void> {
	const request = await pending.get(id)
	if (!request) {
		throw new Error('This request has expired')
	}
	let result: Fido2Result
	try {
		result = await resolveDecision(request, decision)
	} catch (e) {
		result = errorResult(e)
	}
	await finish(request, result)
}

async function resolveDecision(request: PendingRequest, decision: Fido2Decision): Promise<Fido2Result> {
	switch (decision.action) {
	case 'cancel':
		return cancelled
	case 'fallback':
		return fallback
	case 'save': {
		if (request.kind !== 'create') {
			return cancelled
		}
		const options = request.options as CreationOptionsJSON
		const items = await activeItems()
		if (isExcluded(allPasskeys(items), request.rpId, options.excludeCredentials)) {
			return { status: 'error', name: 'InvalidStateError', message: 'A passkey for this account is already saved in V-Pass.' }
		}
		const { passkey, response } = await createCredential(options, { origin: request.origin })
		// Store first: a site must never get a credential the vault failed to save.
		if (decision.itemId) {
			const target = await findItem(decision.itemId)
			if (target?.item.type !== 'login') {
				throw new Error('That login no longer exists')
			}
			const updated = await modifyItem(decision.itemId, (item) => item.type === 'login'
				? { ...item, passkeys: [...item.passkeys.filter((pk) => pk.credentialId !== passkey.credentialId), passkey] }
				: null)
			if (updated.item.type !== 'login' || !updated.item.passkeys.some((pk) => pk.credentialId === passkey.credentialId)) {
				throw new Error('The passkey could not be saved')
			}
		} else {
			await createItem(newItem('login', {
				title: options.rp?.name || request.rpId,
				username: options.user?.name ?? '',
				urls: [request.origin],
				passkeys: [passkey],
			}))
		}
		return { status: 'ok', response }
	}
	case 'use': {
		if (request.kind !== 'get') {
			return cancelled
		}
		const options = request.options as RequestOptionsJSON
		const found = passkeysFor(await activeItems(), request.rpId, options)
			.find((f) => f.entry.id === decision.itemId && f.passkey.credentialId === decision.credentialId)
		if (!found) {
			return cancelled
		}
		return { status: 'ok', response: await getAssertion(options, found.passkey, { origin: request.origin }) }
	}
	}
}

/** The page aborted (AbortSignal) or navigated. */
export async function abort(sender: chrome.runtime.MessageSender, pageRequestId: string): Promise<void> {
	for (const [, request] of await pending.entries()) {
		if (request.tabId === sender.tab?.id && request.frameId === sender.frameId && request.pageRequestId === pageRequestId) {
			await pending.delete(request.id)
			if (request.windowId !== null) {
				chrome.windows.remove(request.windowId).catch(() => {})
			}
		}
	}
}

/** The user closed the V-Pass window: same as cancelling. */
export async function windowClosed(windowId: number): Promise<void> {
	for (const [, request] of await pending.entries()) {
		if (request.windowId === windowId) {
			request.windowId = null
			await finish(request, cancelled)
		}
	}
}

export async function forgetTabRequests(tabId: number): Promise<void> {
	for (const [, request] of await pending.entries()) {
		if (request.tabId === tabId) {
			await pending.delete(request.id)
			if (request.windowId !== null) {
				chrome.windows.remove(request.windowId).catch(() => {})
			}
		}
	}
}
