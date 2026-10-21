import { InvalidTotpError, NoQrCodeError, newItem, parseTotp, readTotpQr } from '@vpass/core'
import type { TotpScan, TotpTarget } from '../shared/protocol.ts'
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
		totp = await readQr(await (await fetch(shot)).blob(), tab.width)
	} catch (e) {
		if (e instanceof NoQrCodeError) {
			throw new NoQrCodeError('No QR code found on this page. Scroll until the whole code is visible.')
		}
		if (e instanceof InvalidTotpError) {
			throw new InvalidTotpError('This QR code isn\'t a 2FA setup code')
		}
		throw e
	}
	const { issuer, account } = parseTotp(totp)
	return { totp, issuer, account, url: tab.url && /^https?:/i.test(tab.url) ? tab.url : null }
}

/**
 * HiDPI screenshots are several times larger than the page and slow to search
 * (seconds at 4K), so look at the page's CSS size first. Small codes may need
 * the full resolution: fall back to it.
 */
async function readQr(shot: Blob, cssWidth: number | undefined): Promise<string> {
	const full = await createImageBitmap(shot)
	if (cssWidth && cssWidth < full.width) {
		try {
			return await readTotpQr(pixels(await createImageBitmap(shot, { resizeWidth: cssWidth, resizeQuality: 'high' })))
		} catch (e) {
			if (!(e instanceof NoQrCodeError)) {
				full.close()
				throw e
			}
		}
	}
	return readTotpQr(pixels(full))
}

function pixels(bitmap: ImageBitmap): ImageData {
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
	const ctx = canvas.getContext('2d')!
	ctx.drawImage(bitmap, 0, 0)
	bitmap.close()
	return ctx.getImageData(0, 0, canvas.width, canvas.height)
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
