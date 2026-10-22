import { type Item, type LoginItem, base32Decode, decryptItem, encryptItem, initCrypto, newItem, parseTotp, totpCode, unlockWithPassword, uuid } from '@vpass/core'
import type { Page } from '@playwright/test'
import QRCode from 'qrcode'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apiFor } from '../helpers.ts'
import { BASE_URL, GOOGLE_EXPORT, type Harness, IMPORT_KEYS, LOGIN, MASTER, expect, extensionUrl, launch, openPopup, test, vpassFrame } from './fixtures.ts'
import { TOTP_SETUP_URI } from './site.ts'

/*
 * The Chrome extension against the dev Nextcloud (make dev-up) and a local test
 * site. One browser and one user for the whole file, so the tests run in order.
 */
test.describe.configure({ mode: 'serial' })

/** Decrypt the user's vault straight from the server, as a second client would. */
async function vault(h: Harness): Promise<Item[]> {
	await initCrypto()
	const api = apiFor(h.user.id, h.user.password)
	const key = unlockWithPassword(MASTER, (await api.getVault())!)
	const { items } = await api.sync(0)
	return items.filter((r) => r.deletedAt === null).map((r) => decryptItem(key, r).item)
}

async function siteLogin(h: Harness, username = LOGIN.username): Promise<LoginItem> {
	const login = (await vault(h)).find((i): i is LoginItem => i.type === 'login' && i.username === username && i.urls.includes(h.site.origin))
	expect(login, `login ${username}`).toBeTruthy()
	return login!
}

/** Click the V-Pass icon drawn inside a field (it lives in a closed shadow root, so use coordinates). */
async function clickFieldIcon(page: Page, selector: string): Promise<void> {
	const field = page.locator(selector)
	await field.click()
	const box = (await field.boundingBox())!
	await page.waitForTimeout(150)
	await page.mouse.click(box.x + box.width - 17, box.y + box.height / 2)
}

async function unlockInPopup(popup: Page, keepUnlocked = false): Promise<void> {
	await popup.locator('[data-test="master-password"]').fill(MASTER)
	// The checkbox remembers the last choice, so always set it.
	await popup.locator('[data-test="keep-unlocked"]').setChecked(keepUnlocked)
	await expect(popup.locator('[data-test="keep-unlocked-warning"]')).toBeVisible({ visible: keepUnlocked })
	await popup.locator('[data-test="unlock-submit"]').click()
	await expect(popup.locator('[data-test="lock"]')).toBeVisible()
}

test('connects with Nextcloud Login Flow v2 and unlocks with the master password', async ({ harness: h }) => {
	const popup = await h.context.newPage()
	await popup.goto(extensionUrl(h, 'popup/index.html'))
	await popup.locator('[data-test="server-url"]').fill(BASE_URL)
	const flowOpened = h.context.waitForEvent('page')
	await popup.locator('[data-test="connect"]').click()
	const flow = await flowOpened
	await flow.waitForLoadState()
	await flow.getByRole('button', { name: 'Log in', exact: true }).click()
	await flow.locator('input[name="user"]').fill(h.user.id)
	await flow.locator('input[name="password"]').fill(h.user.password)
	await flow.locator('button[type="submit"]').click()
	await flow.getByRole('button', { name: /grant access/i }).click()

	await expect(popup.locator('[data-test="unlock-form"]')).toBeVisible({ timeout: 30_000 })
	await popup.locator('[data-test="master-password"]').fill('not the master password')
	await popup.locator('[data-test="unlock-submit"]').click()
	await expect(popup.locator('[data-test="unlock-error"]')).toContainText('not correct')
	await unlockInPopup(popup)
	await popup.close()
})

test('fills a login from the inline menu and from the popup', async ({ harness: h }) => {
	const page = await h.context.newPage()
	await page.goto(`${h.site.origin}/login`)
	await page.locator('input[name="email"]').click()
	const menu = await vpassFrame(page, 'inline-menu')
	await menu.locator('[data-test="inline-login"]').first().click()
	await expect(page.locator('input[name="email"]')).toHaveValue(LOGIN.username)
	await expect(page.locator('input[name="password"]')).toHaveValue(LOGIN.password)

	await page.locator('input[name="email"]').fill('')
	await page.locator('input[name="password"]').fill('')
	const popup = await openPopup(h, page)
	await popup.reload()
	await popup.locator('[data-test="site-login-Test site"]').click()
	await expect(page.locator('input[name="password"]')).toHaveValue(LOGIN.password)
	await page.close()
})

test('ignores clicks on V-Pass UI that the page made invisible (clickjacking guard)', async ({ harness: h }) => {
	const page = await h.context.newPage()
	await page.goto(`${h.site.origin}/login`)
	// A hostile page fades everything, including V-Pass's menu, to hide it under a decoy.
	await page.addStyleTag({ content: 'html { opacity: 0.05 !important }' })
	await page.locator('input[name="email"]').click()
	const menu = await vpassFrame(page, 'inline-menu')
	await menu.locator('[data-test="inline-login"]').first().click()
	await expect(menu.getByText('could not confirm this menu is fully visible')).toBeVisible()
	await expect(page.locator('input[name="password"]')).toHaveValue('')
	await page.close()
})

test('offers to update a changed password, keeping the old one in the history', async ({ harness: h }) => {
	const page = await h.context.newPage()
	await page.goto(`${h.site.origin}/login`)
	await page.locator('input[name="email"]').fill(LOGIN.username)
	await page.locator('input[name="password"]').fill('Brand-new-pass-2026!')
	await page.getByRole('button', { name: 'Log in' }).click()
	await expect(page.locator('#welcome')).toBeVisible()

	const bar = await vpassFrame(page, 'notification-bar')
	await expect(bar.locator('[data-test="save-bar-title"]')).toContainText('Update the saved password?')
	await bar.locator('[data-test="save-bar-save"]').click()
	await expect.poll(async () => (await siteLogin(h)).password).toBe('Brand-new-pass-2026!')
	expect((await siteLogin(h)).passwordHistory[0]?.password).toBe(LOGIN.password)
	await page.close()
})

test('generates a password on a sign-up form and saves the new login', async ({ harness: h }) => {
	const page = await h.context.newPage()
	await page.goto(`${h.site.origin}/signup`)
	await page.locator('input[name="email"]').fill('bob@example.com')
	await clickFieldIcon(page, 'input[name="password"]')
	const menu = await vpassFrame(page, 'inline-menu')
	await menu.locator('[data-test="inline-generate"]').click()
	const generated = await page.locator('input[name="password"]').inputValue()
	expect(generated.length).toBeGreaterThanOrEqual(16)
	await expect(page.locator('input[name="password2"]')).toHaveValue(generated)

	await page.getByRole('button', { name: 'Sign up' }).click()
	const bar = await vpassFrame(page, 'notification-bar')
	await expect(bar.locator('[data-test="save-bar-title"]')).toContainText('Save this login')
	await bar.locator('[data-test="save-bar-save"]').click()
	await expect.poll(async () => (await vault(h)).some((i) => i.type === 'login' && i.username === 'bob@example.com' && i.password === generated)).toBe(true)
	await page.close()
})

test('fills one-time codes, payment cards and addresses', async ({ harness: h }) => {
	const page = await h.context.newPage()

	await page.goto(`${h.site.origin}/otp`)
	await page.locator('input[name="code"]').click()
	await (await vpassFrame(page, 'inline-menu')).locator('[data-test="inline-login"]').first().click()
	const params = parseTotp(LOGIN.totpSecret)
	const valid = [(await totpCode(params)).code, (await totpCode(params, Date.now() - 30_000)).code]
	expect(valid).toContain(await page.locator('input[name="code"]').inputValue())

	await page.goto(`${h.site.origin}/checkout`)
	await clickFieldIcon(page, 'input[name="cardnumber"]')
	await (await vpassFrame(page, 'inline-menu')).locator('[data-test="inline-card"]').click()
	await expect(page.locator('input[name="cardnumber"]')).toHaveValue('4111111111111111')
	await expect(page.locator('input[name="ccname"]')).toHaveValue('Alice Example')
	await expect(page.locator('input[name="exp"]')).toHaveValue('07/29')
	await expect(page.locator('input[name="cvc"]')).toHaveValue('123')

	await page.goto(`${h.site.origin}/address`)
	await clickFieldIcon(page, 'input[name="first_name"]')
	await (await vpassFrame(page, 'inline-menu')).locator('[data-test="inline-identity"]').click()
	await expect(page.locator('input[name="first_name"]')).toHaveValue('Alice')
	await expect(page.locator('input[name="last_name"]')).toHaveValue('Example')
	await expect(page.locator('input[name="street"]')).toHaveValue('1 Main St')
	await expect(page.locator('input[name="city"]')).toHaveValue('Springfield')
	await expect(page.locator('input[name="zip"]')).toHaveValue('62701')
	await expect(page.locator('select[name="country"]')).toHaveValue('US')
	await expect(page.locator('input[name="phone"]')).toHaveValue('+1 555 0100')
	await page.close()
})

test('creates a passkey in the vault and signs in with it (verified by the site)', async ({ harness: h }) => {
	const page = await h.context.newPage()
	await page.goto(`${h.site.origin}/webauthn`)

	const promptOpened = h.context.waitForEvent('page')
	await page.locator('#register').click()
	const prompt = await promptOpened
	await prompt.locator('[data-test="passkey-save"]').click()
	await expect(page.locator('#result')).toHaveText('registered')
	expect(h.site.credentials).toHaveLength(1)
	const passkey = (await siteLogin(h)).passkeys[0]
	expect(passkey).toMatchObject({ rpId: 'localhost', userName: LOGIN.username, credentialId: h.site.credentials[0]!.credential.id })

	const signInPrompt = h.context.waitForEvent('page')
	await page.locator('#login').click()
	await (await signInPrompt).locator('[data-test="passkey-use"]').first().click()
	await expect(page.locator('#result')).toHaveText(`signed in as ${LOGIN.username}`)
	await page.close()
})

test('offers saved passkeys in the inline menu (passkey autofill)', async ({ harness: h }) => {
	const page = await h.context.newPage()
	await page.goto(`${h.site.origin}/webauthn-autofill`)
	await page.waitForTimeout(500)
	await page.locator('#username').click()
	const menu = await vpassFrame(page, 'inline-menu')
	await menu.locator('[data-test="inline-passkey"]').click()
	await expect(page.locator('#result')).toHaveText(`signed in as ${LOGIN.username}`)
	await page.close()
})

test('"Use another device" hands the request to the browser', async ({ harness: h }) => {
	const page = await h.context.newPage()
	await page.goto(`${h.site.origin}/webauthn`)
	// A virtual security key stands in for "another device".
	const cdp = await h.context.newCDPSession(page)
	await cdp.send('WebAuthn.enable')
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: { protocol: 'ctap2', transport: 'usb', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
	})
	await page.locator('#username').fill('carol@example.com')
	const promptOpened = h.context.waitForEvent('page')
	await page.locator('#register').click()
	await (await promptOpened).locator('[data-test="passkey-fallback"]').click()
	await expect(page.locator('#result')).toHaveText('registered')
	expect(h.site.credentials.find((c) => c.username === 'carol@example.com')).toBeTruthy()
	expect((await vault(h)).some((i) => i.type === 'login' && i.passkeys.some((p) => p.userName === 'carol@example.com'))).toBe(false)
	await page.close()
})

test('sets up a one-time code from the page\'s 2FA QR code, or from a pasted key', async ({ harness: h }) => {
	const page = await h.context.newPage()
	await page.goto(`${h.site.origin}/2fa-setup`)
	const popup = await openPopup(h, page)

	// The site's QR code goes into its login, replacing the old key.
	await popup.locator('[data-test="scan-qr"]').click()
	await expect(popup.locator('[data-test="totp-scan-result"]')).toContainText('Test site')
	await expect(popup.locator('[data-test="totp-scan-result"]')).toContainText(LOGIN.username)
	await popup.locator('[data-test="totp-target-Test site"]').click()
	await expect(popup.locator('[data-test="totp-replaces"]')).toBeVisible()
	await popup.locator('[data-test="save-totp"]').click()
	const params = parseTotp(TOTP_SETUP_URI)
	const valid = [(await totpCode(params)).code, (await totpCode(params, Date.now() - 30_000)).code]
	await expect.poll(async () => (await popup.locator('[data-test="totp-code"]').textContent())?.replace(/\s/g, '')).toMatch(/^\d{6}$/)
	expect(valid).toContain((await popup.locator('[data-test="totp-code"]').textContent())!.replace(/\s/g, ''))
	expect((await siteLogin(h)).totp).toBe(TOTP_SETUP_URI)

	// No QR code on the page: paste the key instead.
	await page.goto(`${h.site.origin}/login`)
	await popup.reload()
	await popup.locator('[data-test="scan-qr"]').click()
	await expect(popup.locator('[data-test="totp-scan-error"]')).toContainText('No QR code found')
	await popup.locator('[data-test="totp-key"]').fill('mzxw 6ytb oi')
	await popup.locator('[data-test^="totp-target-"]', { hasText: 'bob@example.com' }).click()
	await popup.locator('[data-test="save-totp"]').click()
	await expect(popup.locator('[data-test="totp-code"]')).toBeVisible()
	expect((await siteLogin(h, 'bob@example.com')).totp).toBe('mzxw 6ytb oi')

	await popup.close()
	await page.close()
})

test('imports 2FA codes from Google Authenticator (camera and screenshot), an export file and pasted links', async ({ harness: h }) => {
	// A login one of the codes belongs to, saved on another device.
	await initCrypto()
	const api = apiFor(h.user.id, h.user.password)
	const key = unlockWithPassword(MASTER, (await api.getVault())!)
	await api.createItem(encryptItem(key, uuid(), newItem('login', { title: 'Fabrikam', username: 'dave', urls: ['https://fabrikam.example'] })))

	// The popup's 2FA setup links to the import page.
	const popup = await openPopup(h)
	await popup.locator('[data-test="scan-qr"]').click()
	const opened = h.context.waitForEvent('page')
	await popup.locator('[data-test="open-import"]').click()
	const page = await opened
	await popup.close()
	await expect(page.locator('[data-test="otp-import"]')).toBeVisible()
	const found = page.locator('[data-test="otp-found"]')

	// Code 1 of 2 from the (fake) camera.
	await page.locator('[data-test="otp-camera"]').click()
	await expect(found).toContainText('2 codes found')
	await expect(found).toContainText('QR code 1 of 2 scanned')
	await page.locator('[data-test="otp-camera-stop"]').click()

	// Code 2 of 2 from a screenshot, an Aegis export, and a pasted link.
	const aegis = {
		version: 1,
		header: { slots: null, params: null },
		db: { version: 3, entries: [
			{ type: 'totp', name: 'erin', issuer: 'Contoso', info: { secret: IMPORT_KEYS.contoso, algo: 'SHA1', digits: 6, period: 30 } },
			{ type: 'hotp', name: 'old', issuer: 'Counter Corp', info: { secret: IMPORT_KEYS.contoso, algo: 'SHA1', digits: 6, counter: 1 } },
		] },
	}
	await page.locator('[data-test="otp-files"]').setInputFiles([
		{ name: 'screenshot.png', mimeType: 'image/png', buffer: await QRCode.toBuffer(GOOGLE_EXPORT[1]!) },
		{ name: 'aegis.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(aegis)) },
	])
	await expect(found).toContainText('4 codes found')
	await expect(found).toContainText('QR code 2 of 2 scanned')
	await page.locator('[data-test="otp-paste"]').fill(`otpauth://totp/Woodgrove:frank?secret=${IMPORT_KEYS.woodgrove}&issuer=Woodgrove`)
	await page.locator('[data-test="otp-paste-add"]').click()
	await expect(found).toContainText('5 codes found')

	await page.locator('[data-test="otp-review"]').click()
	const list = page.locator('[data-test="otp-review-list"]')
	await expect(list.locator('[data-test="otp-row-Test site"]')).toContainText('Already in Test site')
	await expect(list.locator('[data-test="otp-row-Fabrikam"]')).toContainText('Goes into Fabrikam (dave)')
	await expect(list.locator('[data-test="otp-row-Northwind"]')).toContainText('New login')
	await expect(list.locator('[data-test="otp-row-Contoso"]')).toContainText('New login')
	await expect(list).toContainText('Counter Corp · old: Counter-based (HOTP) codes aren\'t supported')
	await list.locator('[data-test="otp-row-Woodgrove"] input').uncheck()
	await page.locator('[data-test="otp-confirm"]').click()
	await expect(page.locator('[data-test="otp-done"]')).toContainText('3 codes imported')

	const logins = (await vault(h)).filter((i): i is LoginItem => i.type === 'login')
	const keyOf = (title: string) => {
		const login = logins.find((l) => l.title === title)
		return login?.totp ? parseTotp(login.totp).secret : null
	}
	expect(keyOf('Fabrikam')).toEqual(base32Decode(IMPORT_KEYS.fabrikam))
	expect(keyOf('Northwind')).toEqual(base32Decode(IMPORT_KEYS.northwind))
	expect(logins.find((l) => l.title === 'Northwind')?.username).toBe('carol@northwind.example')
	expect(keyOf('Contoso')).toEqual(base32Decode(IMPORT_KEYS.contoso))
	expect(logins.some((l) => l.title === 'Woodgrove')).toBe(false)
	expect(logins.filter((l) => l.title === 'Test site')).toHaveLength(1)
	await page.close()

	// The popup's "2FA codes" tab lists them like an authenticator app; a click copies the code.
	const codesPopup = await openPopup(h)
	await codesPopup.locator('[data-test="tab-codes"]').click()
	const codes = codesPopup.locator('[data-test="codes-list"]')
	for (const name of ['Contoso', 'Fabrikam', 'Northwind', 'Test site']) {
		await expect(codes.locator(`[data-test="code-${name}"] [data-test="code-value"]`)).toHaveText(/^\d{3} \d{3}$/)
	}
	await expect(codes.locator('[data-test="code-Woodgrove"]')).toHaveCount(0)
	await codesPopup.locator('[data-test="codes-search"]').fill('fabri')
	await expect(codes.locator('li')).toHaveCount(1)
	await codes.locator('[data-test="code-Fabrikam"] [data-test="code-value"]').click()
	// Shown only once the clipboard took the code.
	await expect(codes.locator('[data-test="code-copied"]')).toBeVisible()
	await codes.locator('[data-test="code-open"]').click()
	await expect(codesPopup.locator('[data-test="totp-code"]')).toHaveText(/^\d{3} \d{3}$/)
	await codesPopup.close()
})

test('locks, offers to unlock in the field, and "keep unlocked" survives a browser restart', async ({ harness: h }) => {
	let popup = await h.context.newPage()
	await popup.goto(extensionUrl(h, 'popup/index.html'))
	await popup.locator('[data-test="lock"]').click()
	await expect(popup.locator('[data-test="unlock-form"]')).toBeVisible()

	const page = await h.context.newPage()
	await page.goto(`${h.site.origin}/login`)
	await clickFieldIcon(page, 'input[name="email"]')
	await expect((await vpassFrame(page, 'inline-menu')).locator('[data-test="inline-unlock"]')).toBeVisible()
	await page.close()

	await unlockInPopup(popup, true)
	await h.context.close()
	Object.assign(h, await launch(h.userDataDir))
	popup = await h.context.newPage()
	await popup.goto(extensionUrl(h, 'popup/index.html'))
	await expect(popup.locator('[data-test="lock"]')).toBeVisible()

	// Unlocking with the box unticked turns it off: after the next restart V-Pass is locked.
	await popup.locator('[data-test="lock"]').click()
	await unlockInPopup(popup, false)
	await h.context.close()
	Object.assign(h, await launch(h.userDataDir))
	popup = await h.context.newPage()
	await popup.goto(extensionUrl(h, 'popup/index.html'))
	await expect(popup.locator('[data-test="unlock-form"]')).toBeVisible()
})

test('the web app\'s "Browser extension" page connects a fresh browser', async ({ harness: h }) => {
	// A second browser profile with the extension installed but never connected.
	const userDataDir = mkdtempSync(join(tmpdir(), 'vpass-ext-webapp-'))
	const { context } = await launch(userDataDir)
	try {
		const app = await context.newPage()
		await app.goto(`${BASE_URL}/login`)
		await app.locator('input[name="user"]').fill(h.user.id)
		await app.locator('input[name="password"]').fill(h.user.password)
		await app.locator('button[type="submit"]').click()
		await app.waitForURL((url) => !url.pathname.includes('/login'))
		await app.goto(`${BASE_URL}/index.php/apps/vpass/`)
		const master = app.locator('input[data-test="unlock-password"], [data-test="unlock-password"] input').first()
		await master.click()
		// The extension stays out of the V-Pass app itself: no icon or menu in the master password field.
		await app.waitForTimeout(500)
		expect(await app.locator('vpass-overlay').count()).toBe(0)
		await master.fill(MASTER)
		await app.locator('[data-test="unlock-submit"]').click()
		await app.locator('[data-test="nav-extension"]').click()

		await expect(app.locator('[data-test="extension-not-connected"]')).toBeVisible()
		const download = await app.request.get(`${BASE_URL}/index.php/apps/vpass/extension/download`)
		expect(download.status()).toBe(200)
		expect(download.headers()['content-type']).toBe('application/zip')
		expect((await download.body()).subarray(0, 2).toString()).toBe('PK')

		const confirmOpened = context.waitForEvent('page')
		await app.locator('[data-test="extension-connect"]').click()
		const confirm = await confirmOpened
		await expect(confirm.locator('[data-test="connect-confirm"]')).toContainText(new URL(BASE_URL).host)
		const flowOpened = context.waitForEvent('page')
		await confirm.locator('[data-test="connect-confirm-button"]').click()
		const flow = await flowOpened
		await flow.waitForLoadState()
		await flow.getByRole('button', { name: 'Log in', exact: true }).click()
		await flow.getByRole('button', { name: /grant access/i }).click()

		await expect(app.locator('[data-test="extension-connected"]')).toBeVisible({ timeout: 30_000 })
	} finally {
		await context.close()
		rmSync(userDataDir, { recursive: true, force: true })
	}
})
