import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'happy-dom',
		setupFiles: ['test/chrome-stub.ts'],
	},
})
