import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		// Argon2id at 64 MiB takes ~1s per derivation in WASM.
		testTimeout: 30_000,
	},
})
