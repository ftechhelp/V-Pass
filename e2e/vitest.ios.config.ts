import { defineConfig } from 'vitest/config'

// The Swift client against the dev instance (`make test-ios-interop`).
export default defineConfig({
	test: {
		include: ['e2e/ios/**/*.test.ts'],
		environment: 'node',
		testTimeout: 120_000,
		hookTimeout: 120_000,
		// The tests in the file build on each other (seed → Swift → checks).
		sequence: { concurrent: false },
		fileParallelism: false,
	},
})
