import { FLOW_ALARM, isLoginFlowTab, pollLoginFlow } from './account.ts'
import { fillBestLogin, fillGeneratedIntoFocused, forgetTab, forgetTabFrames, generateFromSettings, openUnlock } from './autofill.ts'
import { refreshBadge } from './badge.ts'
import { CLEAR_ALARM, clearClipboard, scheduleClear, writeClipboard } from './clipboard.ts'
import { forgetTabRequests, windowClosed } from './fido2.ts'
import { handleMessage, onConnected } from './router.ts'
import { forgetTabSaves } from './save.ts'
import { isUnlocked, lock, onLockChange } from './session.ts'
import { getSettings, onSettingsChange } from './settings.ts'
import { local } from './storage.ts'
import { onVaultChange, sync } from './vault.ts'

/*
 * Service worker entry. MV3 requires every listener to be registered
 * synchronously at startup, so they are all here.
 */

const SYNC_ALARM = 'sync'

chrome.runtime.onMessage.addListener(handleMessage)

/* ---------- lifecycle ---------- */

async function ensureAlarms(): Promise<void> {
	if (!(await chrome.alarms.get(SYNC_ALARM))) {
		await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 5 })
	}
}

async function applyIdleSettings(): Promise<void> {
	const { autoLockMinutes } = await getSettings()
	// Minimum 15 s; with auto-lock off the idle state is ignored anyway.
	chrome.idle.setDetectionInterval(Math.max(15, (autoLockMinutes || 240) * 60))
}

/** Content scripts only load into new pages; add them to tabs that were already open. */
async function injectIntoOpenTabs(): Promise<void> {
	const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })
	await Promise.all(tabs.map(async (tab) => {
		if (tab.id === undefined || tab.discarded) return
		try {
			await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content/webauthn-main.js'], world: 'MAIN' })
			await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content/content.js'] })
		} catch {
			// Pages the extension may not script (web store, error pages).
		}
	}))
}

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.removeAll(() => {
		chrome.contextMenus.create({ id: 'vpass-fill', title: 'Fill login', contexts: ['editable'] })
		chrome.contextMenus.create({ id: 'vpass-generate', title: 'Generate password', contexts: ['editable'] })
	})
	void ensureAlarms()
	void applyIdleSettings()
	void injectIntoOpenTabs()
	void refreshBadge()
})

chrome.runtime.onStartup.addListener(() => {
	void ensureAlarms()
	void applyIdleSettings()
	void refreshBadge()
})

onLockChange(() => void refreshBadge())
onVaultChange(() => void refreshBadge())
onSettingsChange(() => void applyIdleSettings())

/* ---------- alarms ---------- */

chrome.alarms.onAlarm.addListener((alarm) => {
	switch (alarm.name) {
	case SYNC_ALARM:
		void local.get('account').then((account) => account && sync().catch(() => {}))
		break
	case FLOW_ALARM:
		void pollLoginFlow(onConnected).catch((e) => console.error(e))
		break
	case CLEAR_ALARM:
		void clearClipboard()
		break
	}
})

/* ---------- auto-lock ---------- */

chrome.idle.onStateChanged.addListener((state) => {
	void (async () => {
		if (state === 'active' || !(await isUnlocked()) || (await local.get('persistedVaultKey'))) {
			// "Keep unlocked" disables every automatic lock.
			return
		}
		const settings = await getSettings()
		if ((state === 'locked' && settings.lockOnSystemLock) || (state === 'idle' && settings.autoLockMinutes > 0)) {
			await lock()
		}
	})()
})

/* ---------- tabs and windows ---------- */

chrome.tabs.onRemoved.addListener((tabId) => {
	void forgetTab(tabId)
	void forgetTabSaves(tabId)
	void forgetTabRequests(tabId)
})

chrome.tabs.onUpdated.addListener((tabId, change) => {
	if (change.status === 'loading' && change.url) {
		void forgetTabFrames(tabId)
	}
	if (change.url || change.status === 'complete') {
		void isLoginFlowTab(tabId).then((flowTab) => flowTab && pollLoginFlow(onConnected).catch(() => {}))
		void refreshBadge(tabId)
	}
})

chrome.tabs.onActivated.addListener(({ tabId }) => void refreshBadge(tabId))

chrome.windows.onRemoved.addListener((windowId) => void windowClosed(windowId))

/* ---------- shortcuts and context menu ---------- */

async function runCommand(command: string): Promise<void> {
	if (!(await isUnlocked())) {
		await openUnlock()
		return
	}
	if (command === 'autofill-login') {
		await fillBestLogin()
	} else if (command === 'generate-password') {
		const password = await generateFromSettings()
		if (!(await fillGeneratedIntoFocused(password))) {
			await writeClipboard(password)
			await scheduleClear()
		}
	}
}

chrome.commands.onCommand.addListener((command) => void runCommand(command))

chrome.contextMenus.onClicked.addListener((info) => {
	void runCommand(info.menuItemId === 'vpass-fill' ? 'autofill-login' : 'generate-password')
})

void ensureAlarms()
