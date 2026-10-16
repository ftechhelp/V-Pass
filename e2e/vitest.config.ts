import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['e2e/api/**/*.test.ts'],
		environment: 'node',
		testTimeout: 60_000,
		hookTimeout: 60_000,
		// Tests in a file build on each other (vault → items → …).
		sequence: { concurrent: false },
		fileParallelism: false,
	},
})
