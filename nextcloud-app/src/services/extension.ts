import { loadState } from '@nextcloud/initial-state'
import { generateUrl } from '@nextcloud/router'

/**
 * Talking to the V-Pass browser extension from the web app ("Browser
 * extension" page). The extension's content script answers window messages
 * on V-Pass pages only, and never says which server it is connected to; only
 * whether it is this one.
 */

/**
 * The extension's Chrome Web Store listing. Empty until Google approves the
 * listing; then the page shows "Add to Chrome" and the download becomes the
 * fallback. Set it to https://chromewebstore.google.com/detail/<extension id>.
 */
export const CHROME_WEB_STORE_URL = ''

/** Version of the extension this server offers for download, or null. */
export const bundledExtensionVersion = loadState<{ extensionVersion: string | null }>('vpass', 'config', { extensionVersion: null }).extensionVersion ?? null

export const extensionDownloadUrl = generateUrl('/apps/vpass/extension/download')

export interface ExtensionStatus {
	version: string
	connected: boolean
	/** Connected to this Nextcloud. */
	thisServer: boolean
	locked: boolean
	/** A Nextcloud sign-in for the extension is in progress. */
	connecting: boolean
}

export type ConnectResult = 'confirm' | 'already' | 'other-server' | 'connecting'

function ask<T>(kind: 'status' | 'connect', timeoutMs: number): Promise<T | null> {
	return new Promise((resolve) => {
		const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
		const done = (value: T | null) => {
			clearTimeout(timer)
			window.removeEventListener('message', onMessage)
			resolve(value)
		}
		const onMessage = (event: MessageEvent) => {
			const data = event.data as ({ vpass?: string, id?: string, error?: string } & T) | null
			if (event.source === window && data?.vpass === 'extension' && data.id === id) {
				done(data.error ? null : data)
			}
		}
		const timer = setTimeout(() => done(null), timeoutMs)
		window.addEventListener('message', onMessage)
		window.postMessage({ vpass: 'webapp', kind, id }, window.location.origin)
	})
}

/** The extension in this browser, or null when it isn't installed (or is disabled). */
export function extensionStatus(): Promise<ExtensionStatus | null> {
	return ask<ExtensionStatus>('status', 800)
}

/** Ask the extension to connect to this Nextcloud (it asks the user to confirm in its own window). */
export async function connectExtension(): Promise<ConnectResult | null> {
	return (await ask<{ result: ConnectResult }>('connect', 3000))?.result ?? null
}

/** Chrome, Edge, Brave, Opera, Vivaldi…: browsers that can run the extension. */
export function isChromium(): boolean {
	const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands
	return brands ? brands.some((b) => b.brand === 'Chromium') : /Chrome\/\d/.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent)
}

/** Compare dotted versions ("0.1.10" > "0.1.9"). */
export function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map(Number)
	const pb = b.split('.').map(Number)
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
		if (diff !== 0) return Math.sign(diff)
	}
	return 0
}
