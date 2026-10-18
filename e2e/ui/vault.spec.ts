import { type Page, expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { type TestUser, createTestUser, deleteTestUser } from '../helpers.ts'

const MASTER = 'orbit velvet cactus lantern 91'
const FIXTURE = fileURLToPath(new URL('../../packages/core/test/fixtures/nordpass-export.csv', import.meta.url))

let user: TestUser

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
	user = await createTestUser('vpass-ui')
})

test.afterAll(async () => {
	if (user) await deleteTestUser(user.id)
})

async function login(page: Page): Promise<void> {
	await page.goto('/login')
	await page.locator('input[name="user"]').fill(user.id)
	await page.locator('input[name="password"]').fill(user.password)
	await page.locator('button[type="submit"]').click()
	await page.waitForURL((url) => !url.pathname.includes('/login'))
	await page.goto('/apps/vpass/')
}

// Nextcloud inputs (NcTextField, NcPasswordField) put data-test on the <input> itself;
// wrapper components like PasswordInput put it on their root element.
function field(page: Page, id: string) {
	return page.locator(`input[data-test="${id}"], [data-test="${id}"] input`).first()
}

async function unlock(page: Page, password = MASTER): Promise<void> {
	await field(page, 'unlock-password').fill(password)
	await page.locator('[data-test="unlock-submit"]').click()
}

test('onboarding, items, lock/unlock and NordPass import', async ({ page }) => {
	await login(page)

	await test.step('create the vault and save the recovery key', async () => {
		await field(page, 'master-password').fill(MASTER)
		await field(page, 'master-password-confirm').fill(MASTER)
		await page.locator('[data-test="create-vault"]').click()
		await expect(page.locator('[data-test="recovery-key"]')).toHaveText(/^([A-Z2-7]{4}-){13}[A-Z2-7]{4}$/)
		await page.getByText('I have saved my recovery key somewhere safe').click()
		await page.locator('[data-test="recovery-continue"]').click()
		await page.locator('[data-test="finish-setup"]').click()
		await expect(page.getByText('Your vault is empty')).toBeVisible()
	})

	await test.step('add a login', async () => {
		await page.locator('[data-test="new-item"] button').first().click()
		await page.getByRole('menuitem', { name: 'Password' }).click()
		await field(page, 'field-title').fill('GitHub')
		await field(page, 'field-username').fill('alice@example.com')
		await field(page, 'field-password').fill('s3cret-Pa55word!')
		await page.getByRole('button', { name: 'Add website' }).click()
		await field(page, 'field-url').fill('https://github.com')
		await page.locator('[data-test="save-item"]').click()
		await expect(page.getByRole('heading', { name: 'GitHub' })).toBeVisible()
		await page.getByRole('button', { name: 'Show Password' }).click()
		await expect(page.locator('[data-test="field-password"]')).toContainText('s3cret-Pa55word!')
	})

	await test.step('lock and unlock', async () => {
		await page.locator('[data-test="lock"]').click()
		await expect(page.locator('[data-test="unlock"]')).toBeVisible()
		await unlock(page, 'wrong password')
		await expect(page.getByText('That master password is not correct')).toBeVisible()
		await unlock(page)
		await expect(page.locator('[data-test="nav-all"]')).toBeVisible()
		await expect(page.getByText('GitHub').first()).toBeVisible()
	})

	await test.step('a reload locks the vault (keys only live in memory)', async () => {
		await page.reload()
		await expect(page.locator('[data-test="unlock"]')).toBeVisible()
		await unlock(page)
	})

	await test.step('import a NordPass export', async () => {
		await page.locator('[data-test="nav-import"]').click()
		await page.locator('[data-test="import-file"]').setInputFiles(FIXTURE)
		const preview = page.locator('[data-test="import-preview"]')
		await expect(preview).toContainText('3 Passwords')
		await expect(preview).toContainText('1 Secure notes')
		await expect(preview).toContainText('1 Credit cards')
		await expect(preview).toContainText('1 Personal info')
		await expect(preview).toContainText('wallet_address')
		// The fixture's GitHub login matches the one added above (same host and username).
		await expect(page.getByText('Skip 1 item that is already in your vault')).toBeVisible()
		await page.locator('[data-test="confirm-import"]').click()
		await expect(page.locator('[data-test="import-done"]')).toContainText('5 items were imported')
		await page.locator('[data-test="nav-card"]').click()
		await expect(page.getByText('Visa Gold')).toBeVisible()
		await page.getByText('Visa Gold').click()
		await expect(page.getByText('•••• 1111')).toBeVisible()
	})
})

test('passkey unlock via WebAuthn PRF (virtual authenticator)', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Uses the Chrome DevTools virtual authenticator')
	const cdp = await page.context().newCDPSession(page)
	await cdp.send('WebAuthn.enable')
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
	})

	await login(page)
	await unlock(page)
	await page.goto('/apps/vpass/#/settings')
	await page.getByLabel('Name (e.g. “Laptop fingerprint”)').fill('Virtual authenticator')
	await page.getByRole('button', { name: 'Add passkey' }).click()
	await expect(page.getByText('Virtual authenticator')).toBeVisible()

	await page.locator('[data-test="lock"]').click()
	await page.getByRole('button', { name: 'Unlock with passkey' }).click()
	await expect(page.locator('[data-test="nav-all"]')).toBeVisible()
})

test('the "Browser extension" page offers the Chrome Web Store when the extension is missing', async ({ page }) => {
	await login(page)
	await unlock(page)
	await page.goto('/apps/vpass/#/extension')
	await expect(page.locator('[data-test="extension-missing"]')).toBeVisible()
	await expect(page.locator('[data-test="extension-store"]')).toHaveAttribute('href', 'https://chromewebstore.google.com/detail/v-pass/fnbnjjalcjpopkiobdkaaffdiccolbfl')
	// The bundled zip is only the fallback now.
	await expect(page.locator('[data-test="extension-manual"]')).toBeHidden()
	await page.getByRole('button', { name: 'Install it by hand instead' }).click()
	await expect(page.locator('[data-test="extension-manual"]')).toBeVisible()
	await expect(page.locator('[data-test="extension-download"]')).toBeVisible()
})
