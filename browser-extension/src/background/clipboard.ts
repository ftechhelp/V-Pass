import { getSettings } from './settings.ts'

/**
 * Clipboard access from the service worker goes through an offscreen document
 * (workers have no DOM). Pages copy by themselves and then ask the background
 * to clear the clipboard after the configured delay.
 */

const OFFSCREEN_URL = 'offscreen/index.html'
export const CLEAR_ALARM = 'clipboard-clear'

let creating: Promise<void> | null = null
let clearTimer: ReturnType<typeof setTimeout> | undefined

async function ensureOffscreen(): Promise<void> {
	const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] })
	if (contexts.length > 0) {
		return
	}
	creating ??= chrome.offscreen.createDocument({
		url: OFFSCREEN_URL,
		reasons: ['CLIPBOARD' as chrome.offscreen.Reason],
		justification: 'Copy generated passwords and clear copied secrets from the clipboard',
	}).finally(() => {
		creating = null
	})
	await creating
}

export async function writeClipboard(text: string): Promise<void> {
	await ensureOffscreen()
	await chrome.runtime.sendMessage({ target: 'offscreen', type: 'clipboard', text })
}

/** Clear the clipboard after the configured delay (0 = never). */
export async function scheduleClear(): Promise<void> {
	const seconds = (await getSettings()).clipboardClearSeconds
	clearTimeout(clearTimer)
	await chrome.alarms.clear(CLEAR_ALARM)
	if (seconds <= 0) {
		return
	}
	// Timer for short delays while the worker is alive; the alarm (≥ 30 s) covers a stopped worker.
	clearTimer = setTimeout(() => void clearClipboard(), seconds * 1000)
	await chrome.alarms.create(CLEAR_ALARM, { when: Date.now() + Math.max(seconds, 30) * 1000 })
}

export async function clearClipboard(): Promise<void> {
	clearTimeout(clearTimer)
	await chrome.alarms.clear(CLEAR_ALARM)
	try {
		await writeClipboard('')
	} finally {
		await chrome.offscreen.closeDocument().catch(() => {})
	}
}
