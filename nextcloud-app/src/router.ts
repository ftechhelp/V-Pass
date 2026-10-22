import { createRouter, createWebHashHistory } from 'vue-router'
import VaultView from './views/VaultView.vue'

const CATEGORY_RE = 'all|login|passkey|note|card|identity|favorites'

export const router = createRouter({
	// Hash history: deep links work without extra server routes.
	history: createWebHashHistory(),
	routes: [
		{ path: '/', redirect: '/vault/all' },
		{ path: `/vault/:category(${CATEGORY_RE})/:itemId?`, name: 'category', component: VaultView, props: true },
		{ path: '/folder/:folderId/:itemId?', name: 'folder', component: VaultView, props: true },
		{ path: '/trash/:itemId?', name: 'trash', component: VaultView, props: (route) => ({ trash: true, itemId: route.params.itemId }) },
		{ path: '/codes', name: 'codes', component: () => import('./views/CodesView.vue') },
		{ path: '/generator', name: 'generator', component: () => import('./views/GeneratorView.vue') },
		{ path: '/health', name: 'health', component: () => import('./views/HealthView.vue') },
		{ path: '/import', name: 'import', component: () => import('./views/ImportExportView.vue') },
		{ path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
		{ path: '/extension', name: 'extension', component: () => import('./views/ExtensionView.vue') },
		{ path: '/:pathMatch(.*)*', redirect: '/vault/all' },
	],
})
