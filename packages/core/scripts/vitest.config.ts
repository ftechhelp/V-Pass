import { defineConfig } from 'vitest/config'

// Runs the generator scripts in this folder (they are vitest files so they can
// import the TypeScript sources directly): `npm run vectors:ios`.
export default defineConfig({
	test: {
		include: ['scripts/*.ts'],
		exclude: ['scripts/vitest.config.ts'],
		environment: 'node',
		testTimeout: 60_000,
	},
})
