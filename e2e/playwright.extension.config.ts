import { defineConfig } from '@playwright/test'

/** The Chrome extension (browser-extension/dist, built first) against the dev Nextcloud. */
export default defineConfig({
	testDir: './extension',
	timeout: 120_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	outputDir: './test-results/extension',
	reporter: [['list'], ['html', { outputFolder: './playwright-report/extension', open: 'never' }]],
	use: {
		// The tests launch (and restart) their own persistent Chromium; Playwright's
		// tracing of those contexts is flaky when they close mid-test.
		trace: 'off',
		screenshot: 'only-on-failure',
	},
})
