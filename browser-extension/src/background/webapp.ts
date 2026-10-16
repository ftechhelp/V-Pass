import type { WebAppConnectResult, WebAppStatus } from '../shared/protocol.ts'
import { isVPassApp } from '../shared/vpass-app.ts'
import { getAccount, loginFlowUrl, normaliseServer } from './account.ts'
import { isUnlocked } from './session.ts'

/**
 * Requests from the V-Pass web app's "Browser extension" page (relayed by the
 * content script). The page only learns the extension's version and whether
 * it is connected to *this* server; connecting needs the user's confirmation
 * in an extension window that shows the server address.
 */

let connectWindowId: number | null = null

/** The Nextcloud base URL of a V-Pass app page, or an error for any other page. */
function appServer(sender: chrome.runtime.MessageSender): string {
	const url = sender.url ? new URL(sender.url) : null
	const secure = url && (url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1')
	if (!url || !secure || sender.frameId !== 0 || !isVPassApp(url.pathname)) {
		const error = new Error('Only the V-Pass web app can ask this')
		error.name = 'NotAllowedError'
		throw error
	}
	return normaliseServer(url.href)
}

const sameServer = (a: string, b: string) => normaliseServer(a).toLowerCase() === normaliseServer(b).toLowerCase()

export async function webAppStatus(sender: chrome.runtime.MessageSender): Promise<WebAppStatus> {
	const server = appServer(sender)
	const account = await getAccount()
	return {
		version: chrome.runtime.getManifest().version,
		connected: account !== null,
		thisServer: account !== null && sameServer(account.server, server),
		locked: account === null || !(await isUnlocked()),
		connecting: account === null && (await loginFlowUrl()) !== null,
	}
}

export async function webAppConnect(sender: chrome.runtime.MessageSender): Promise<{ result: WebAppConnectResult }> {
	const server = appServer(sender)
	const account = await getAccount()
	if (account) {
		return { result: sameServer(account.server, server) ? 'already' : 'other-server' }
	}
	if (await loginFlowUrl()) {
		return { result: 'connecting' }
	}
	if (connectWindowId !== null) {
		try {
			await chrome.windows.update(connectWindowId, { focused: true })
			return { result: 'confirm' }
		} catch {
			connectWindowId = null
		}
	}
	const created = await chrome.windows.create({
		url: chrome.runtime.getURL(`prompt/index.html#connect=${encodeURIComponent(server)}`),
		type: 'popup',
		width: 440,
		height: 480,
		focused: true,
	})
	connectWindowId = created?.id ?? null
	return { result: 'confirm' }
}

export function connectWindowClosed(windowId: number): void {
	if (windowId === connectWindowId) {
		connectWindowId = null
	}
}
