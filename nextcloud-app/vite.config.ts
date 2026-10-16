import { createAppConfig } from '@nextcloud/vite-config'

// Outputs js/vpass-main.mjs and js/vpass-admin.mjs (app id read from appinfo/info.xml).
export default createAppConfig({
	main: 'src/main.ts',
	admin: 'src/admin.ts',
}, {
	// Inject CSS from JS so PHP only needs Util::addScript(); each entry
	// (main app, admin settings) injects the CSS it actually imports.
	inlineCSS: { relativeCSSInjection: true },
	config: {
		build: {
			// libsodium + zxcvbn dictionaries are large but lazy/necessary.
			chunkSizeWarningLimit: 2500,
		},
	},
})
