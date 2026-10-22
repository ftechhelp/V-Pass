import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { type UserConfig, defineConfig } from 'vite'

/**
 * One config, four builds (see `npm run build`), all into dist/:
 * - pages:      the Vue extension pages (popup, options, import, prompt, iframes, offscreen) + public/
 * - background: the module service worker as ONE file (service workers cannot
 *               use dynamic import(), so everything is inlined)
 * - content:    the isolated-world content script (MV3 content scripts must be
 *               single-file classic scripts → IIFE)
 * - main-world: the page-world WebAuthn shim (IIFE)
 */
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

const PAGES = ['popup', 'options', 'import', 'prompt', 'inline-menu', 'notification-bar', 'offscreen']

export default defineConfig(({ mode }): UserConfig => {
	const shared: UserConfig = {
		define: { 'process.env.NODE_ENV': JSON.stringify('production') },
		build: {
			outDir: here('dist'),
			emptyOutDir: false,
			target: 'chrome120',
			sourcemap: true,
			// Readable output makes the unpacked extension easy to audit.
			minify: false,
			chunkSizeWarningLimit: 3000,
		},
	}

	const script = (entry: string, fileName: string, format: 'es' | 'iife'): UserConfig => ({
		...shared,
		build: {
			...shared.build,
			lib: { entry: here(entry), formats: [format], fileName: () => fileName, name: 'vpass' },
			rollupOptions: { output: { inlineDynamicImports: true } },
		},
	})

	switch (mode) {
	case 'pages':
		return {
			...shared,
			root: here('src/pages'),
			base: '/',
			publicDir: here('public'),
			plugins: [vue()],
			build: {
				...shared.build,
				emptyOutDir: true,
				rollupOptions: {
					input: Object.fromEntries(PAGES.map((p) => [p, here(`src/pages/${p}/index.html`)])),
				},
			},
		}
	case 'background':
		return script('src/background/index.ts', 'background.js', 'es')
	case 'content':
		return script('src/content/content.ts', 'content/content.js', 'iife')
	case 'main-world':
		return script('src/content/webauthn-main.ts', 'content/webauthn-main.js', 'iife')
	default:
		throw new Error(`Unknown build mode "${mode}": use pages, background, content or main-world`)
	}
})
