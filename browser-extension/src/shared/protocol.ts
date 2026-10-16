import type {
	AuthenticationResponseJSON,
	CreationOptionsJSON,
	CredentialDescriptorJSON,
	Item,
	RegistrationResponseJSON,
	RequestOptionsJSON,
} from '@vpass/core'
import type { Settings } from './settings.ts'

/**
 * Messages between the extension's parts. The background service worker owns
 * every secret; pages and content scripts ask it for exactly what they need.
 *
 * Trust rules (enforced in background/router.ts):
 * - Full-access pages (popup, options, prompt) may send any `UiMessages`.
 * - The in-page iframes (inline menu, notification bar) may only send their
 *   token-scoped messages.
 * - Content scripts may only send `ContentMessages`; their origin is always
 *   taken from the browser's `sender`, never from the message.
 */

/* ---------- views ---------- */

export type LockStatus = 'disconnected' | 'connecting' | 'locked' | 'unlocked'

export interface ExtensionState {
	status: LockStatus
	server: string | null
	user: string | null
	/** Login Flow v2 URL while connecting, so the UI can reopen it. */
	loginUrl: string | null
	/** The account has no vault yet (create it in the web app first). */
	noVault: boolean
	keepUnlocked: boolean
	lastSync: number | null
	syncError: string | null
}

export interface ItemView {
	id: string
	item: Item
	updatedAt: number
	folderName: string | null
}

export interface SiteView {
	/** Page URL of the active tab, or null for pages V-Pass can't fill (chrome://, the web store…). */
	url: string | null
	host: string | null
	logins: { id: string, insecure: boolean }[]
	/** Whether the page has card / address fields worth offering cards or identities for. */
	hasCardFields: boolean
	hasIdentityFields: boolean
}

export interface TotpView {
	code: string
	period: number
	/** Seconds until the code changes. */
	remaining: number
}

/* ---------- autofill ---------- */

/** Autocomplete tokens V-Pass fills. Content scripts classify fields into these. */
export type CardField = 'cc-name' | 'cc-number' | 'cc-exp' | 'cc-exp-month' | 'cc-exp-year' | 'cc-csc' | 'cc-type'
export type IdentityField = 'name' | 'given-name' | 'additional-name' | 'family-name' | 'email' | 'tel' | 'organization'
	| 'street-address' | 'address-line1' | 'address-line2' | 'address-level2' | 'address-level1' | 'postal-code'
	| 'country' | 'country-name' | 'bday'

export type FieldKind = 'username' | 'password' | 'new-password' | 'totp' | 'card' | 'identity'

export interface FillPayload {
	username?: string
	password?: string
	/** Generated password for new-password fields (both "new" and "confirm"). */
	newPassword?: string
	totp?: string
	card?: Partial<Record<CardField, string>>
	identity?: Partial<Record<IdentityField, string>>
}

/** What a frame found, reported whenever its forms change. */
export interface FrameForms {
	login: boolean
	newPassword: boolean
	totp: boolean
	card: boolean
	identity: boolean
}

export interface InlineEntry {
	id: string
	title: string
	subtitle: string
}

export interface InlineView {
	locked: boolean
	fieldKind: FieldKind
	host: string
	logins: InlineEntry[]
	passkeys: (InlineEntry & { credentialId: string })[]
	cards: InlineEntry[]
	identities: InlineEntry[]
	/** True on new-password fields: offer "Generate password". */
	canGenerate: boolean
}

export type InlineChoice =
	| { kind: 'login', id: string }
	| { kind: 'passkey', id: string, credentialId: string }
	| { kind: 'card', id: string }
	| { kind: 'identity', id: string }
	| { kind: 'generate' }
	| { kind: 'unlock' }

/** A pending conditional-mediation get() in the frame (passkey autofill). */
export interface ConditionalRequest {
	rpId: string | null
	allowCredentials: CredentialDescriptorJSON[]
}

/* ---------- save prompts ---------- */

export interface SaveBarView {
	kind: 'new' | 'update'
	host: string
	username: string
	/** Title of the login being updated. */
	itemTitle: string | null
}

export type SaveBarAction = 'save' | 'never' | 'dismiss'

/* ---------- passkeys ---------- */

export interface Fido2Details {
	kind: 'create' | 'get'
	origin: string
	rpId: string
	rpName: string
	userName: string
	locked: boolean
	/** create: logins the new passkey could be attached to; get: logins holding usable passkeys. */
	candidates: { id: string, title: string, username: string, credentialId?: string }[]
	excluded: boolean
}

export type Fido2Decision =
	| { action: 'save', itemId: string | null }
	| { action: 'use', itemId: string, credentialId: string }
	| { action: 'fallback' }
	| { action: 'cancel' }

/* ---------- the V-Pass web app's "Browser extension" page ---------- */

export interface WebAppStatus {
	version: string
	connected: boolean
	/** Connected to the Nextcloud this page belongs to (never which other server). */
	thisServer: boolean
	locked: boolean
	/** A Nextcloud sign-in (Login Flow v2) is in progress. */
	connecting: boolean
}

/** confirm: a V-Pass window asks the user; already / other-server / connecting: nothing to do. */
export type WebAppConnectResult = 'confirm' | 'already' | 'other-server' | 'connecting'

export type Fido2Result =
	| { status: 'ok', response: RegistrationResponseJSON | AuthenticationResponseJSON }
	| { status: 'fallback' }
	| { status: 'error', name: string, message: string }

/* ---------- message maps: type → [request payload, response] ---------- */

export interface UiMessages {
	state: [object, ExtensionState]
	connect: [{ server: string }, ExtensionState]
	cancelConnect: [object, ExtensionState]
	disconnect: [object, ExtensionState]
	unlock: [{ password: string, keepUnlocked: boolean }, ExtensionState]
	lock: [object, ExtensionState]
	setKeepUnlocked: [{ value: boolean }, ExtensionState]
	sync: [object, ExtensionState]
	items: [object, ItemView[]]
	site: [object, SiteView]
	/** `force`: the user confirmed filling on a site the login isn't saved for (or over http). */
	fill: [{ itemId: string, force?: boolean }, { filled: boolean, reason?: string }]
	totp: [{ itemId: string }, TotpView]
	copied: [object, void]
	generate: [object, string]
	/** Fill a generated password into the page's focused password field. */
	fillGenerated: [{ password: string }, boolean]
	getSettings: [object, Settings]
	setSettings: [{ patch: Partial<Settings> }, Settings]
	neverSaveList: [object, string[]]
	removeNeverSave: [{ host: string }, string[]]
	fido2Details: [{ requestId: string }, Fido2Details]
	fido2Decide: [{ requestId: string, decision: Fido2Decision }, void]
	heartbeat: [object, void]
	openWebVault: [object, void]
}

/** Messages the in-page iframes may send (scoped by their token). */
export interface FrameUiMessages {
	inlineData: [{ token: string }, InlineView]
	inlineChoose: [{ token: string, choice: InlineChoice }, void]
	inlineClose: [{ token: string }, void]
	saveBarData: [{ token: string }, SaveBarView]
	saveBarRespond: [{ token: string, action: SaveBarAction }, void]
}

export interface ContentMessages {
	frameForms: [{ forms: FrameForms }, { locked: boolean, matches: number, inlineMenu: boolean, offerToSave: boolean }]
	openInline: [{ fieldKind: FieldKind, conditional: ConditionalRequest | null }, { token: string, url: string }]
	submitted: [{ username: string, password: string, newPassword: string | null }, void]
	pendingSaveBar: [object, { token: string, url: string } | null]
	fido2Create: [{ requestId: string, options: CreationOptionsJSON }, { status: 'pending' } | Fido2Result]
	fido2Get: [{ requestId: string, options: RequestOptionsJSON, credentialId: string | null }, { status: 'pending' } | Fido2Result]
	fido2Abort: [{ requestId: string }, void]
	passkeyProvider: [object, boolean]
	webAppStatus: [object, WebAppStatus]
	webAppConnect: [object, { result: WebAppConnectResult }]
}

/** Commands the background sends to a content script frame. */
export type ContentCommand =
	| { type: 'fill', payload: FillPayload, fieldKind: FieldKind | null }
	| { type: 'showSaveBar', token: string, url: string }
	| { type: 'closeInline' }
	| { type: 'closeSaveBar' }
	| { type: 'fido2Result', requestId: string, result: Fido2Result }
	| { type: 'passkeyChosen', credentialId: string }

export type MessageMap = UiMessages & FrameUiMessages & ContentMessages
export type MessageType = keyof MessageMap
export type Request<K extends MessageType = MessageType> = { [T in K]: { type: T } & MessageMap[T][0] }[K]
export type Response<K extends MessageType> = MessageMap[K][1]

export type Envelope<T> = { ok: true, value: T } | { ok: false, error: { name: string, message: string } }
