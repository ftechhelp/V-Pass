import { defineConfig, devices } from '@playwright/test'

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
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
