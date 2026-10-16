import type {
	ContentMessages,
	Envelope,
	ExtensionState,
	FrameUiMessages,
	MessageType,
	Request,
	Response,
	UiMessages,
} from '../shared/protocol.ts'
import { cancelLoginFlow, disconnect, getAccount, loginFlowUrl, startLoginFlow } from './account.ts'
import {
	closeInline,
	fillGeneratedIntoFocused,
	fillItem,
	generateFromSettings,
	inlineChoose,
	inlineData,
	openInline,
	registerFrame,
	siteView,
	totpFor,
} from './autofill.ts'
import { refreshBadge } from './badge.ts'
import { scheduleClear } from './clipboard.ts'
import { abort, decide, details, handleCreate, handleGet } from './fido2.ts'
import { barRespond, barView, pendingBar, submitted } from './save.ts'
import { isUnlocked, lock, setKeepUnlocked, unlock } from './session.ts'
import { getSettings, neverSaveList, removeNeverSave, setSettings } from './settings.ts'
import { local } from './storage.ts'
import { clearVault, itemViews, sync } from './vault.ts'

type Sender = chrome.runtime.MessageSender
type Handler<K extends MessageType> = (message: Request<K>, sender: Sender) => Promise<Response<K>> | Response<K>
type Handlers<M> = { [K in keyof M & MessageType]: Handler<K> }

/* ---------- state ---------- */

let lastSyncStarted = 0

/** Sync in the background when the UI opens, at most once a minute. */
function syncSoon(): void {
	if (Date.now() - lastSyncStarted < 60_000) {
		return
	}
	lastSyncStarted = Date.now()
	sync().catch(() => {})
}

export async function onConnected(): Promise<void> {
	lastSyncStarted = Date.now()
	await sync().catch(() => {})
	await refreshBadge()
}

async function state(): Promise<ExtensionState> {
	const account = await getAccount()
	const loginUrl = await loginFlowUrl()
	const lastSync = (await local.get('lastSync')) ?? null
	const unlocked = account ? await isUnlocked() : false
	return {
		status: account ? (unlocked ? 'unlocked' : 'locked') : (loginUrl ? 'connecting' : 'disconnected'),
		server: account?.server ?? null,
		user: account?.loginName ?? null,
		loginUrl,
		noVault: Boolean(account && lastSync !== null && !(await local.get('vaultMeta'))),
		keepUnlocked: (await local.get('keepUnlocked')) ?? false,
		lastSync,
		syncError: (await local.get('syncError')) ?? null,
	}
}

/* ---------- handlers ---------- */

/** Popup, options page and prompt window: full access. */
const pageHandlers: Handlers<UiMessages> = {
	async state() {
		if (await getAccount()) syncSoon()
		return state()
	},
	async connect({ server }) {
		await startLoginFlow(server, onConnected)
		return state()
	},
	async cancelConnect() {
		await cancelLoginFlow()
		return state()
	},
	async disconnect() {
		await lock()
		await disconnect()
		await clearVault()
		await local.remove('account', 'keepUnlocked', 'persistedVaultKey')
		await refreshBadge()
		return state()
	},
	async unlock({ password, keepUnlocked }) {
		await unlock(password, keepUnlocked)
		lastSyncStarted = Date.now()
		await sync().catch(() => {})
		await refreshBadge()
		return state()
	},
	async lock() {
		await lock()
		await refreshBadge()
		return state()
	},
	async setKeepUnlocked({ value }) {
		await setKeepUnlocked(value)
		return state()
	},
	async sync() {
		lastSyncStarted = Date.now()
		await sync()
		await refreshBadge()
		return state()
	},
	items: () => itemViews(),
	site: () => siteView(),
	fill: ({ itemId, force }) => fillItem(itemId, force ?? false),
	totp: ({ itemId }) => totpFor(itemId),
	copied: () => scheduleClear(),
	generate: () => generateFromSettings(),
	fillGenerated: ({ password }) => fillGeneratedIntoFocused(password),
	getSettings: () => getSettings(),
	setSettings: ({ patch }) => setSettings(patch),
	neverSaveList: () => neverSaveList(),
	removeNeverSave: ({ host }) => removeNeverSave(host),
	fido2Details: ({ requestId }) => details(requestId),
	fido2Decide: ({ requestId, decision }) => decide(requestId, decision),
	heartbeat: () => undefined,
	async openWebVault() {
		const account = await getAccount()
		if (account) {
			await chrome.tabs.create({ url: `${account.server}/index.php/apps/vpass/` })
		}
	},
}

/** Inline menu and notification bar iframes: only their own token-scoped calls. */
const frameUiHandlers: Handlers<FrameUiMessages> = {
	inlineData: ({ token }, sender) => inlineData(token, sender),
	inlineChoose: ({ token, choice }, sender) => inlineChoose(token, choice, sender),
	inlineClose: ({ token }, sender) => closeInline(token, sender),
	saveBarData: ({ token }, sender) => barView(token, sender),
	saveBarRespond: ({ token, action }, sender) => barRespond(token, action, sender),
}

/** Content scripts in web pages. Their origin is read from `sender` only. */
const contentHandlers: Handlers<ContentMessages> = {
	async frameForms({ forms }, sender) {
		const settings = await getSettings()
		const matches = await registerFrame(sender, forms)
		return { locked: !(await isUnlocked()), matches, inlineMenu: settings.inlineMenu, offerToSave: settings.offerToSave }
	},
	openInline: ({ fieldKind, conditional }, sender) => openInline(sender, fieldKind, conditional),
	submitted: ({ username, password, newPassword }, sender) => submitted(sender, username, password, newPassword),
	pendingSaveBar: (_message, sender) => pendingBar(sender),
	fido2Create: ({ requestId, options }, sender) => handleCreate(sender, requestId, options),
	fido2Get: ({ requestId, options, credentialId }, sender) => handleGet(sender, requestId, options, credentialId),
	fido2Abort: ({ requestId }, sender) => abort(sender, requestId),
	passkeyProvider: async () => (await getSettings()).passkeyProvider,
}

/* ---------- dispatch ---------- */

type SenderKind = 'page' | 'frame-ui' | 'content'

/** "chrome-extension://<id>/" */
const EXTENSION_ROOT = chrome.runtime.getURL('')

export function senderKind(sender: Sender): SenderKind | null {
	if (sender.id !== chrome.runtime.id) {
		return null
	}
	const url = sender.url ?? ''
	if (url.startsWith(EXTENSION_ROOT)) {
		const path = `/${url.slice(EXTENSION_ROOT.length)}`
		if (path.startsWith('/inline-menu/') || path.startsWith('/notification-bar/')) {
			return 'frame-ui'
		}
		if (path.startsWith('/popup/') || path.startsWith('/options/') || path.startsWith('/prompt/')) {
			return 'page'
		}
		return null
	}
	return sender.tab && sender.frameId !== undefined ? 'content' : null
}

const tables: Record<SenderKind, Record<string, Handler<MessageType>>> = {
	'page': pageHandlers as unknown as Record<string, Handler<MessageType>>,
	'frame-ui': frameUiHandlers as unknown as Record<string, Handler<MessageType>>,
	'content': contentHandlers as unknown as Record<string, Handler<MessageType>>,
}

export function handleMessage(message: unknown, sender: Sender, sendResponse: (reply: Envelope<unknown>) => void): boolean {
	if (!message || typeof message !== 'object' || 'target' in message) {
		// Messages for the offscreen document are not ours.
		return false
	}
	const type = (message as { type?: unknown }).type
	const kind = senderKind(sender)
	const handler = kind && typeof type === 'string' && Object.hasOwn(tables[kind], type) ? tables[kind][type] : undefined
	if (!handler) {
		sendResponse({ ok: false, error: { name: 'NotAllowedError', message: 'V-Pass refused this request' } })
		return false
	}
	Promise.resolve()
		.then(() => handler(message as Request<MessageType>, sender))
		.then(
			(value) => sendResponse({ ok: true, value }),
			(e: unknown) => {
				const error = e as Error
				sendResponse({ ok: false, error: { name: error?.name ?? 'Error', message: error?.message ?? String(e) } })
			},
		)
	return true
}
