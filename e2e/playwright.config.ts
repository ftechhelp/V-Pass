import { defineConfig, devices } from '@playwright/test'
import { fakeCameraShowing } from './qr-video.ts'
import { GOOGLE_EXPORT } from './ui/authenticator-export.ts'

export default defineConfig({
	testDir: './ui',
	timeout: 120_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	outputDir: './test-results',
	reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
	use: {
		baseURL: process.env.VPASS_URL ?? 'http://localhost:8080',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		permissions: ['clipboard-read', 'clipboard-write'],
	},
	// The camera shows code 1 of the 2FA import test's Google Authenticator export.
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: fakeCameraShowing(GOOGLE_EXPORT[0]!) } } }],
})
