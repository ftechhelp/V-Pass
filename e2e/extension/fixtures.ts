import { type BrowserContext, type Frame, type Page, test as base, chromium, expect } from '@playwright/test'
import { createVaultKeys, encryptItem, initCrypto, newItem, uuid } from '@vpass/core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE_URL, type TestUser, apiFor, createTestUser, deleteTestUser } from '../helpers.ts'
import { type TestSite, startTestSite } from './site.ts'

export const MASTER = 'quartz falcon meadow ember 47'
export const LOGIN = { username: 'alice@example.com', password: 'Sup3r-secret-login!', totpSecret: 'JBSWY3DPEHPK3PXP' }
export const EXTENSION_DIR = fileURLToPath(new URL('../../browser-extension/dist', import.meta.url))

export interface Harness {
	context: BrowserContext
	extensionId: string
	user: TestUser
	site: TestSite
	userDataDir: string
}

/** Launch Chromium with the unpacked extension (new headless mode supports extensions). */
export async function launch(userDataDir: string): Promise<{ context: BrowserContext, extensionId: string }> {
	const context = await chromium.launchPersistentContext(userDataDir, {
		channel: 'chromium',
		args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
	})
	let [worker] = context.serviceWorkers()
	worker ??= await context.waitForEvent('serviceworker')
	return { context, extensionId: new URL(worker.url()).host }
}

/** A throwaway Nextcloud user whose vault already holds a login (with TOTP) for the test site, a card and an identity. */
async function seedUser(site: TestSite): Promise<TestUser> {
	const user = await createTestUser('vpass-ext')
	await initCrypto()
	const api = apiFor(user.id, user.password)
	const { keyset, vaultKey } = createVaultKeys(MASTER)
	await api.createVault(keyset)
	const items = [
		newItem('login', { title: 'Test site', username: LOGIN.username, password: LOGIN.password, urls: [site.origin], totp: LOGIN.totpSecret }),
		newItem('card', { title: 'Visa', cardholderName: 'Alice Example', number: '4111 1111 1111 1111', expMonth: '07', expYear: '2029', cvc: '123' }),
		newItem('identity', { title: 'Home', firstName: 'Alice', lastName: 'Example', address1: '1 Main St', city: 'Springfield', zip: '62701', country: 'US', phone: '+1 555 0100' }),
	]
	for (const item of items) {
		await api.createItem(encryptItem(vaultKey, uuid(), item))
	}
	return user
}

export const test = base.extend<object, { harness: Harness }>({
	harness: [async ({}, use) => {
		const site = await startTestSite()
		const user = await seedUser(site)
		const userDataDir = mkdtempSync(join(tmpdir(), 'vpass-ext-'))
		const { context, extensionId } = await launch(userDataDir)
		const harness: Harness = { context, extensionId, user, site, userDataDir }
		await use(harness)
		await harness.context.close()
		await site.close()
		if (!process.env.VPASS_KEEP_USERS) await deleteTestUser(user.id)
		rmSync(userDataDir, { recursive: true, force: true })
	}, { scope: 'worker' }],
})

export { expect }

export function extensionUrl(h: Harness, path: string): string {
	return `chrome-extension://${h.extensionId}/${path}`
}

/**
 * The V-Pass iframe whose URL contains `name` (inline-menu, notification-bar).
 * Waits like a person would: the iframes ignore clicks until they have been
 * visibly on screen for a moment (clickjacking guard).
 */
export async function vpassFrame(page: Page, name: string): Promise<Frame> {
	await expect.poll(() => page.frames().some((f) => f.url().includes(`/${name}/`)), { timeout: 10_000 }).toBe(true)
	await page.waitForTimeout(700)
	return page.frames().find((f) => f.url().includes(`/${name}/`))!
}

/** Open the popup as a tab, then put `site` back in front so it is the "active tab" the popup works on. */
export async function openPopup(h: Harness, front?: Page): Promise<Page> {
	const popup = await h.context.newPage()
	await popup.goto(extensionUrl(h, 'popup/index.html'))
	await front?.bringToFront()
	return popup
}

export { BASE_URL }
