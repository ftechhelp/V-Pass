import { type BrowserContext, type Frame, type Page, expect, test } from '@playwright/test'
import { b64urlEncode, createCredential, createVaultKeys, encryptItem, initCrypto, newItem, randomBytes, uuid } from '@vpass/core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE_URL, apiFor, createTestUser, deleteTestUser } from '../helpers.ts'
import { launch, vpassFrame } from './fixtures.ts'

/*
 * Regenerates the Chrome Web Store images in browser-extension/store/images:
 *   VPASS_STORE_IMAGES=1 npx playwright test -c e2e/playwright.extension.config.ts store-images
 * (needs `make dev-up` and a built extension). A fictional site,
 * https://mail.northwind.example, is served by request interception, so the
 * screenshots show the real extension UI on a realistic page.
 */
test.skip(!process.env.VPASS_STORE_IMAGES, 'Set VPASS_STORE_IMAGES=1 to regenerate the Chrome Web Store images')

const OUT = fileURLToPath(new URL('../../browser-extension/store/images', import.meta.url))
const DEMO = 'https://mail.northwind.example'
const MASTER = 'orchid lantern basalt river 82'

const SHIELD = 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm0 6a2.5 2.5 0 0 1 1.25 4.67V16h-2.5v-4.33A2.5 2.5 0 0 1 12 7Z'

const SITE_CSS = `
* { box-sizing: border-box } body { margin: 0; min-height: 100vh; font-family: sans-serif; background: #f2f4f7; color: #1d2433 }
header { height: 64px; display: flex; align-items: center; gap: 10px; padding: 0 32px; background: #fff; border-bottom: 1px solid #e3e7ee; font-weight: 700; font-size: 20px; color: #4338ca }
.logo { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; background: #4338ca; color: #fff; font-size: 16px }
.card { width: 420px; margin: 72px auto; padding: 36px; background: #fff; border-radius: 16px; box-shadow: 0 10px 30px rgba(15, 23, 42, .08) }
h1 { margin: 0 0 6px; font-size: 26px } p { margin: 0 0 24px; color: #5b6475 }
label { display: block; margin: 16px 0 6px; font-weight: 600; font-size: 14px }
input { width: 100%; padding: 12px 14px; font-size: 16px; border: 1px solid #cfd6e3; border-radius: 10px }
button { width: 100%; margin-top: 24px; padding: 13px; font: inherit; font-size: 16px; font-weight: 600; color: #fff; background: #4338ca; border: 0; border-radius: 10px }
`

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Northwind Mail</title><style>${SITE_CSS}</style></head>
<body><header><span class="logo">N</span>Northwind Mail</header>${body}</body></html>`

const DEMO_PAGES: Record<string, string> = {
	'/': page(`<form class="card" method="post" action="/inbox">
		<h1>Sign in</h1><p>Welcome back to Northwind Mail.</p>
		<label>Email<input name="email" type="email" autocomplete="username"></label>
		<label>Password<input name="password" type="password" autocomplete="current-password"></label>
		<button type="submit">Sign in</button></form>`),
	'/inbox': page('<div class="card"><h1>Inbox</h1><p>You have 3 new messages.</p></div>'),
	'/passkey': page(`<div class="card"><h1>Security</h1><p>Sign in faster and safer with a passkey.</p>
		<button id="create">Create a passkey</button></div>
		<script>
		document.getElementById('create').onclick = () => navigator.credentials.create({ publicKey: {
			rp: { name: 'Northwind Mail' },
			user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'alex@example.com', displayName: 'Alex' },
			challenge: crypto.getRandomValues(new Uint8Array(32)),
			pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
			authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
		} }).catch(() => {})
		</script>`),
}

async function seedDemoVault(): Promise<{ id: string, password: string }> {
	const user = await createTestUser('vpass-store')
	await initCrypto()
	const api = apiFor(user.id, user.password)
	const { keyset, vaultKey } = createVaultKeys(MASTER)
	await api.createVault(keyset)
	const { passkey } = await createCredential({
		rp: { id: 'fabrikam.example', name: 'Fabrikam' },
		user: { id: b64urlEncode(randomBytes(16)), name: 'alex@example.com', displayName: 'Alex' },
		challenge: b64urlEncode(randomBytes(32)),
		pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
	}, { origin: 'https://shop.fabrikam.example' })
	const items = [
		newItem('login', { title: 'Northwind Mail', username: 'alex@example.com', password: 'kX9#vR2!qLm7$wPz', urls: [DEMO], totp: 'JBSWY3DPEHPK3PXP', favorite: true }),
		newItem('login', { title: 'Northwind Mail (work)', username: 'alex.reyes@northwind.example', password: 'Tq4%nB8@zH1&cV6r', urls: [DEMO] }),
		newItem('login', { title: 'Fabrikam', username: 'alex@example.com', password: 'mP3$xW9!kD2#fL8q', urls: ['https://shop.fabrikam.example'], passkeys: [passkey] }),
		newItem('login', { title: 'Contoso Bank', username: 'alexr', password: 'Zr7&gN2!vQ5@pK9m', urls: ['https://bank.contoso.example'], totp: 'JBSWY3DPEHPK3PXQ' }),
		newItem('login', { title: 'Tailspin Travel', username: 'alex@example.com', password: 'Hw6#sJ1!tY8$bR3n', urls: ['https://tailspin.example'] }),
		newItem('card', { title: 'Visa', cardholderName: 'Alex Reyes', number: '4111 1111 1111 1111', expMonth: '07', expYear: '2029', cvc: '123' }),
		newItem('identity', { title: 'Home', firstName: 'Alex', lastName: 'Reyes', email: 'alex@example.com', address1: '1 Main St', city: 'Springfield', zip: '62701', country: 'US' }),
		newItem('note', { title: 'Wi-Fi at home', notes: 'Network: Reyes-5G' }),
	]
	for (const item of items) {
		await api.createItem(encryptItem(vaultKey, uuid(), item))
	}
	return user
}

async function connectAndUnlock(context: BrowserContext, extensionId: string, user: { id: string, password: string }): Promise<void> {
	const popup = await context.newPage()
	await popup.goto(`chrome-extension://${extensionId}/popup/index.html`)
	await popup.locator('[data-test="server-url"]').fill(BASE_URL)
	const flowOpened = context.waitForEvent('page')
	await popup.locator('[data-test="connect"]').click()
	const flow = await flowOpened
	await flow.waitForLoadState()
	await flow.getByRole('button', { name: 'Log in', exact: true }).click()
	await flow.locator('input[name="user"]').fill(user.id)
	await flow.locator('input[name="password"]').fill(user.password)
	await flow.locator('button[type="submit"]').click()
	await flow.getByRole('button', { name: /grant access/i }).click()
	await expect(popup.locator('[data-test="unlock-form"]')).toBeVisible({ timeout: 30_000 })
	await popup.locator('[data-test="master-password"]').fill(MASTER)
	await popup.locator('[data-test="keep-unlocked"]').setChecked(false)
	await popup.locator('[data-test="unlock-submit"]').click()
	await expect(popup.locator('[data-test="lock"]')).toBeVisible()
	await popup.close()
}

/**
 * Some Linux desktops map the UI font (system-ui) to a monospace face; the
 * store images use the generic sans-serif face instead.
 */
async function sansSerif(target: Page | Frame): Promise<void> {
	await target.addStyleTag({ content: '*, *::before, *::after { font-family: sans-serif !important }' })
}

/** A 1280×800 store screenshot: headline and text on the left, real UI captures on the right. */
async function compose(context: BrowserContext, file: string, headline: string, text: string, images: Buffer[]): Promise<void> {
	const canvas = await context.newPage()
	await canvas.setViewportSize({ width: 1280, height: 800 })
	await canvas.setContent(`<!doctype html><html><head><style>
		body { margin: 0; width: 1280px; height: 800px; display: flex; align-items: center; justify-content: center; gap: 48px;
			background: linear-gradient(135deg, #0082c9 0%, #005f94 100%); font-family: sans-serif; color: #fff; overflow: hidden }
		.text { width: 380px } h1 { font-size: 42px; line-height: 1.15; margin: 0 0 18px } p { font-size: 20px; line-height: 1.5; margin: 0; opacity: .92 }
		img { max-height: 660px; border-radius: 14px; box-shadow: 0 24px 60px rgba(0, 0, 0, .35); background: #fff }
		</style></head><body><div class="text"><h1>${headline}</h1><p>${text}</p></div>
		${images.map((b) => `<img src="data:image/png;base64,${b.toString('base64')}">`).join('')}</body></html>`)
	await canvas.waitForLoadState()
	await canvas.screenshot({ path: join(OUT, file) })
	await canvas.close()
}

async function popupShot(context: BrowserContext, extensionId: string, front: Page, prepare: (popup: Page) => Promise<void>): Promise<Buffer> {
	const popup = await context.newPage()
	await popup.setViewportSize({ width: 380, height: 580 })
	await popup.goto(`chrome-extension://${extensionId}/popup/index.html`)
	await front.bringToFront()
	await popup.reload()
	await expect(popup.locator('[data-test="lock"]')).toBeVisible()
	await sansSerif(popup)
	await prepare(popup)
	await popup.waitForTimeout(600)
	const shot = await popup.screenshot()
	await popup.close()
	return shot
}

test('Chrome Web Store images', async () => {
	test.setTimeout(300_000)
	mkdirSync(OUT, { recursive: true })
	const user = await seedDemoVault()
	const userDataDir = mkdtempSync(join(tmpdir(), 'vpass-store-'))
	const { context, extensionId } = await launch(userDataDir)
	try {
		await context.route(`${DEMO}/**`, (route) => route.fulfill({
			contentType: 'text/html; charset=utf-8',
			body: DEMO_PAGES[new URL(route.request().url()).pathname] ?? DEMO_PAGES['/']!,
		}))
		await connectAndUnlock(context, extensionId, user)

		// 1. The inline menu in a login form.
		const site = await context.newPage()
		await site.setViewportSize({ width: 1280, height: 800 })
		await site.goto(`${DEMO}/`)
		await site.locator('input[name="email"]').click()
		await sansSerif(await vpassFrame(site, 'inline-menu'))
		await site.waitForTimeout(200)
		await site.screenshot({ path: join(OUT, 'screenshot-1-autofill.png') })

		// 2. The toolbar popup on this site.
		const thisSite = await popupShot(context, extensionId, site, async () => {})
		await compose(context, 'screenshot-2-popup.png', 'Your logins, one click away',
			'V-Pass shows the logins saved for the site you are on. Fill them, or copy a username, password or 2FA code.', [thisSite])

		// 3. Saving a passkey.
		await site.goto(`${DEMO}/passkey`)
		const promptOpened = context.waitForEvent('page')
		await site.locator('#create').click()
		const prompt = await promptOpened
		await prompt.waitForLoadState()
		await prompt.setViewportSize({ width: 440, height: 540 })
		await expect(prompt.locator('[data-test="passkey-save"]')).toBeVisible()
		await sansSerif(prompt)
		await prompt.waitForTimeout(500)
		const passkeyShot = await prompt.screenshot()
		await prompt.getByRole('button', { name: 'Cancel' }).click()
		await compose(context, 'screenshot-3-passkeys.png', 'Passkeys, kept in your own vault',
			'Save the passkeys websites create in V-Pass, then sign in with them on any computer. Your phone and security keys keep working too.', [passkeyShot])

		// 4. Offering to save a new login.
		await site.goto(`${DEMO}/`)
		await site.locator('input[name="email"]').fill('sam@example.com')
		await site.locator('input[name="password"]').fill('Fresh-pass-2026!')
		await site.locator('button[type="submit"]').click()
		await sansSerif(await vpassFrame(site, 'notification-bar'))
		await site.waitForTimeout(200)
		await site.screenshot({ path: join(OUT, 'screenshot-4-save.png') })

		// 5. The vault and the generator.
		const vault = await popupShot(context, extensionId, site, async (p) => {
			await p.locator('[data-test="tab-vault"]').click()
		})
		const generator = await popupShot(context, extensionId, site, async (p) => {
			await p.locator('[data-test="tab-generator"]').click()
		})
		await compose(context, 'screenshot-5-vault.png', 'Your whole vault, end-to-end encrypted',
			'Search every login, card and note, and generate strong passwords. Everything is decrypted only on your device; your Nextcloud stores ciphertext.', [vault, generator])

		// Small promo tile, 440×280.
		const tile = await context.newPage()
		await tile.setViewportSize({ width: 440, height: 280 })
		await tile.setContent(`<!doctype html><html><head><style>
			body { margin: 0; width: 440px; height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center;
				background: linear-gradient(135deg, #0082c9 0%, #005f94 100%); font-family: sans-serif; color: #fff }
			h1 { margin: 10px 0 4px; font-size: 40px } p { margin: 0; font-size: 18px; opacity: .92 }
			</style></head><body><svg width="84" height="84" viewBox="0 0 24 24"><path fill="#fff" fill-rule="evenodd" d="${SHIELD}"/></svg>
			<h1>V-Pass</h1><p>Your password manager on Nextcloud</p></body></html>`)
		await tile.screenshot({ path: join(OUT, 'promo-small-440x280.png') })
	} finally {
		await context.close()
		rmSync(userDataDir, { recursive: true, force: true })
		await deleteTestUser(user.id)
	}
})
