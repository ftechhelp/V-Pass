declare module '*.vue' {
	import type { DefineComponent } from 'vue'
	const component: DefineComponent<object, object, unknown>
	export default component
}

declare module 'vue-material-design-icons/*.vue' {
	import type { DefineComponent } from 'vue'
	const component: DefineComponent<{ size?: number, title?: string, fillColor?: string }>
	export default component
}

/** Injected by @nextcloud/vite-config. */
declare const appName: string
declare const appVersion: string
