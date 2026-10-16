import type { CreationOptionsJSON, RequestOptionsJSON } from '@vpass/core'
import type { Fido2Result } from '../shared/protocol.ts'

/**
 * window.postMessage protocol between the page-world WebAuthn shim and the
 * isolated content script of the same frame. The page can read and forge these
 * messages, which is fine: it could call navigator.credentials itself, and the
 * background takes the caller's origin from the browser, not from here.
 */
export type PageMessage =
	| { vpass: 'page', kind: 'create', id: string, options: CreationOptionsJSON }
	| { vpass: 'page', kind: 'get', id: string, options: RequestOptionsJSON }
	| { vpass: 'page', kind: 'conditional', id: string, options: RequestOptionsJSON }
	| { vpass: 'page', kind: 'abort', id: string }
	| { vpass: 'page', kind: 'status', id: string }

export type ContentReply =
	| { vpass: 'content', id: string, ack: true }
	| { vpass: 'content', id: string, result: Fido2Result }
	| { vpass: 'content', id: string, enabled: boolean }
