import {
	ExportQrCodeError,
	InvalidTotpError,
	NoQrCodeError,
	isGoogleAuthenticatorExport,
	newItem,
	newLoginForAuthenticatorEntry,
	parseTotp,
	readQrTextFromImage,
} from '@vpass/core'
import type { TotpImportCode, TotpScan, TotpTarget } from '../shared/protocol.ts'
import { activeTab } from './autofill.ts'
import { createItem, modifyItem } from './vault.ts'

/**
 * Setting up one-time codes from the popup: read the site's 2FA QR code from a
 * screenshot of the visible tab, then store the key in a login. The screenshot
 * is decoded here and dropped; the popup only gets the QR code's text.
 */

export async function scanActiveTab(): Promise<TotpScan> {
	const tab = await activeTab()
	if (!tab) {
		throw new Error('There is no page to scan')
	}
	let shot: string
	try {
		shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
	} catch {
		throw new Error('V-Pass can\'t read this page')
	}
	let totp: string
	try {
		// HiDPI screenshots are several times larger than the page and slow to
		// search (seconds at 4K): core looks at the page's CSS size first.
		totp = await readQrTextFromImage(await (await fetch(shot)).blob(), tab.width)
	} catch (e) {
		if (e instanceof NoQrCodeError) {
			throw new NoQrCodeError('No QR code found on this page. Scroll until the whole code is visible.')
		}
		throw e
	}
	if (isGoogleAuthenticatorExport(totp)) {
		throw new ExportQrCodeError('This is a Google Authenticator export code. Use "Import 2FA codes" below to move all of them.')
	}
	let params
	try {
		params = parseTotp(totp)
	} catch {
		throw new InvalidTotpError('This QR code isn\'t a 2FA setup code')
	}
	return { totp, issuer: params.issuer, account: params.account, url: tab.url && /^https?:/i.test(tab.url) ? tab.url : null }
}

export async function saveTotp(input: string, into: TotpTarget): Promise<{ itemId: string }> {
	const totp = input.trim()
	parseTotp(totp)
	if ('itemId' in into) {
		const updated = await modifyItem(into.itemId, (item) => item.type === 'login' ? { ...item, totp } : null)
		if (updated.item.type !== 'login' || updated.item.totp !== totp) {
			throw new Error('The login could not be updated')
		}
		return { itemId: updated.id }
	}
	const { title, username, url } = into.newLogin
	const created = await createItem(newItem('login', {
		title: title.trim(),
		username: username.trim(),
		totp,
		urls: url ? [new URL(url).origin] : [],
	}))
	return { itemId: created.id }
}

/** Codes from another authenticator app, as the import page planned them with core. */
export async function importTotpCodes(codes: TotpImportCode[]): Promise<{ saved: number }> {
	let saved = 0
	for (const code of codes) {
		parseTotp(code.totp)
		if (code.itemId) {
			await modifyItem(code.itemId, (item) => item.type === 'login' ? { ...item, totp: code.totp } : null)
		} else {
			await createItem(newLoginForAuthenticatorEntry(code))
		}
		saved++
	}
	return { saved }
}

export async function openImportPage(): Promise<void> {
	await chrome.tabs.create({ url: chrome.runtime.getURL('import/index.html') })
}
