<template>
	<div class="vault">
		<header class="top">
			<div class="logo"><ShieldLockIcon :size="22" class="brand" /> V-Pass</div>
			<div class="grow" />
			<button class="icon-btn" title="Scan a 2FA QR code on this page" data-test="scan-qr" @click="setupFor = { itemId: null }"><QrcodeScanIcon :size="18" /></button>
			<button class="icon-btn" :class="{ spinning: syncing }" :title="syncTitle" @click="syncNow"><SyncIcon :size="18" /></button>
			<button class="icon-btn" title="Open V-Pass on Nextcloud" @click="send('openWebVault')"><OpenInNewIcon :size="18" /></button>
			<button class="icon-btn" title="Settings" @click="openOptions"><CogIcon :size="18" /></button>
			<button class="icon-btn" title="Lock" data-test="lock" @click="lockNow"><LockIcon :size="18" /></button>
		</header>

		<nav class="tabs">
			<button v-for="t in TABS" :key="t.id" class="tab" :class="{ active: tab === t.id }" :data-test="`tab-${t.id}`" @click="tab = t.id; selected = null; setupFor = null">
				{{ t.label }}
			</button>
		</nav>

		<p v-if="state.syncError" class="note warning small sync-error">Offline: showing the last synced copy. ({{ state.syncError }})</p>

		<div v-if="confirmFill" class="note warning confirm">
			<p>{{ confirmFill.message }}</p>
			<div class="row">
				<button class="btn primary" @click="fill(confirmFill.itemId, true)">Fill anyway</button>
				<button class="btn link" @click="confirmFill = null">Cancel</button>
			</div>
		</div>
		<p v-if="notice" class="note small notice">{{ notice }}</p>

		<main class="body">
			<TotpSetup v-if="setupFor"
				:items="items"
				:site="site"
				:item-id="setupFor.itemId"
				@back="setupFor = null"
				@saved="totpSaved" />
			<ItemDetail v-else-if="selectedItem"
				:entry="selectedItem"
				@back="selected = null"
				@fill="fill"
				@scan="setupFor = { itemId: $event }" />

			<!-- This site -->
			<template v-else-if="tab === 'site'">
				<p v-if="!site?.url" class="empty muted">V-Pass can't fill this page.</p>
				<template v-else>
					<h3 class="section">Logins for {{ site.host }}</h3>
					<ul v-if="siteLogins.length" class="list" data-test="site-logins">
						<li v-for="entry in siteLogins" :key="entry.id">
							<div class="list-item" role="button" tabindex="0" :data-test="`site-login-${entry.item.title}`" @click="fill(entry.id)" @keydown.enter="fill(entry.id)">
								<span class="avatar">{{ initial(entry.item.title) }}</span>
								<span class="grow">
									<span class="ellipsis title">{{ entry.item.title || '(untitled)' }}</span>
									<span class="ellipsis muted small">{{ loginOf(entry)?.username || 'No username' }}</span>
								</span>
								<button class="icon-btn" title="Copy username" @click.stop="copy(loginOf(entry)?.username ?? '', `u-${entry.id}`)">
									<CheckIcon v-if="copied === `u-${entry.id}`" :size="18" />
									<AccountIcon v-else :size="18" />
								</button>
								<button class="icon-btn" title="Copy password" @click.stop="copy(loginOf(entry)?.password ?? '', `p-${entry.id}`)">
									<CheckIcon v-if="copied === `p-${entry.id}`" :size="18" />
									<KeyIcon v-else :size="18" />
								</button>
								<button v-if="loginOf(entry)?.totp" class="icon-btn" title="Copy one-time code" @click.stop="copyTotp(entry.id)">
									<CheckIcon v-if="copied === `t-${entry.id}`" :size="18" />
									<CellphoneIcon v-else :size="18" />
								</button>
								<button class="icon-btn" title="Details" @click.stop="selected = entry.id"><DotsVerticalIcon :size="18" /></button>
							</div>
						</li>
					</ul>
					<p v-else class="muted small empty-inline">No logins saved for this site yet. Sign in and V-Pass offers to save it.</p>

					<template v-if="site.hasCardFields && cards.length">
						<h3 class="section">Cards</h3>
						<ul class="list">
							<li v-for="entry in cards" :key="entry.id">
								<button class="list-item" @click="fill(entry.id)">
									<span class="avatar"><CreditCardIcon :size="18" /></span>
									<span class="grow"><span class="ellipsis title">{{ entry.item.title }}</span><span class="muted small">{{ subtitle(entry) }}</span></span>
								</button>
							</li>
						</ul>
					</template>
					<template v-if="site.hasIdentityFields && identities.length">
						<h3 class="section">Personal info</h3>
						<ul class="list">
							<li v-for="entry in identities" :key="entry.id">
								<button class="list-item" @click="fill(entry.id)">
									<span class="avatar"><CardAccountDetailsIcon :size="18" /></span>
									<span class="grow"><span class="ellipsis title">{{ entry.item.title }}</span><span class="muted small">{{ subtitle(entry) }}</span></span>
								</button>
							</li>
						</ul>
					</template>
				</template>
			</template>

			<!-- Vault -->
			<template v-else-if="tab === 'vault'">
				<div class="search">
					<MagnifyIcon :size="18" class="muted" />
					<input v-model="query" class="search-input" placeholder="Search the vault" data-test="search" autofocus>
				</div>
				<div class="chips">
					<button v-for="c in CATEGORIES" :key="c.id" class="chip" :class="{ active: category === c.id }" @click="category = c.id">{{ c.label }}</button>
				</div>
				<ul v-if="filtered.length" class="list">
					<li v-for="entry in filtered" :key="entry.id">
						<button class="list-item" :data-test="`item-${entry.item.title}`" @click="selected = entry.id">
							<span class="avatar">
								<CreditCardIcon v-if="entry.item.type === 'card'" :size="18" />
								<CardAccountDetailsIcon v-else-if="entry.item.type === 'identity'" :size="18" />
								<NoteTextIcon v-else-if="entry.item.type === 'note'" :size="18" />
								<template v-else>{{ initial(entry.item.title) }}</template>
							</span>
							<span class="grow">
								<span class="ellipsis title">{{ entry.item.title || '(untitled)' }}</span>
								<span class="ellipsis muted small">{{ subtitle(entry) }}</span>
							</span>
							<StarIcon v-if="entry.item.favorite" :size="16" class="star" />
						</button>
					</li>
				</ul>
				<p v-else class="empty muted">{{ items.length ? 'Nothing matches.' : 'Your vault is empty.' }}</p>
			</template>

			<GeneratorPanel v-else />
		</main>
	</div>
</template>

<script setup lang="ts">
import { type LoginItem, itemSearchText, itemSubtitle } from '@vpass/core'
import { computed, onMounted, ref } from 'vue'
import AccountIcon from 'vue-material-design-icons/Account.vue'
import CardAccountDetailsIcon from 'vue-material-design-icons/CardAccountDetails.vue'
import CellphoneIcon from 'vue-material-design-icons/Cellphone.vue'
import CheckIcon from 'vue-material-design-icons/Check.vue'
import CogIcon from 'vue-material-design-icons/Cog.vue'
import CreditCardIcon from 'vue-material-design-icons/CreditCard.vue'
import DotsVerticalIcon from 'vue-material-design-icons/DotsVertical.vue'
import KeyIcon from 'vue-material-design-icons/Key.vue'
import LockIcon from 'vue-material-design-icons/Lock.vue'
import MagnifyIcon from 'vue-material-design-icons/Magnify.vue'
import NoteTextIcon from 'vue-material-design-icons/NoteText.vue'
import OpenInNewIcon from 'vue-material-design-icons/OpenInNew.vue'
import QrcodeScanIcon from 'vue-material-design-icons/QrcodeScan.vue'
import ShieldLockIcon from 'vue-material-design-icons/ShieldLock.vue'
import StarIcon from 'vue-material-design-icons/Star.vue'
import SyncIcon from 'vue-material-design-icons/Sync.vue'
import type { ExtensionState, ItemView, SiteView } from '../../shared/protocol.ts'
import { send } from '../../shared/runtime.ts'
import { useCopy } from '../ui/copy.ts'
import GeneratorPanel from './GeneratorPanel.vue'
import ItemDetail from './ItemDetail.vue'
import TotpSetup from './TotpSetup.vue'

const props = defineProps<{ state: ExtensionState }>()
const emit = defineEmits<{ update: [state: ExtensionState] }>()

type Tab = 'site' | 'vault' | 'generator'
const TABS: { id: Tab, label: string }[] = [{ id: 'site', label: 'This site' }, { id: 'vault', label: 'Vault' }, { id: 'generator', label: 'Generator' }]
type Category = 'all' | 'login' | 'passkey' | 'note' | 'card' | 'identity' | 'favorites'
const CATEGORIES: { id: Category, label: string }[] = [
	{ id: 'all', label: 'All' }, { id: 'login', label: 'Logins' }, { id: 'passkey', label: 'Passkeys' }, { id: 'note', label: 'Notes' },
	{ id: 'card', label: 'Cards' }, { id: 'identity', label: 'Personal info' }, { id: 'favorites', label: 'Favorites' },
]

const items = ref<ItemView[]>([])
const site = ref<SiteView | null>(null)
const tab = ref<Tab>('site')
const selected = ref<string | null>(null)
/** The "set up a one-time code" view, optionally for one login. */
const setupFor = ref<{ itemId: string | null } | null>(null)
const query = ref('')
const category = ref<Category>('all')
const syncing = ref(false)
const notice = ref('')
const confirmFill = ref<{ itemId: string, message: string } | null>(null)
const { copied, copy } = useCopy()

const byId = computed(() => new Map(items.value.map((e) => [e.id, e])))
const selectedItem = computed(() => selected.value ? byId.value.get(selected.value) ?? null : null)
const siteLogins = computed(() => (site.value?.logins ?? []).map((l) => byId.value.get(l.id)).filter((e): e is ItemView => !!e))
const cards = computed(() => sorted(items.value.filter((e) => e.item.type === 'card')))
const identities = computed(() => sorted(items.value.filter((e) => e.item.type === 'identity')))
const searchText = computed(() => new Map(items.value.map((e) => [e.id, itemSearchText(e.item)])))
const filtered = computed(() => {
	const terms = query.value.toLowerCase().split(/\s+/).filter(Boolean)
	return sorted(items.value.filter((e) => inCategory(e, category.value) && terms.every((t) => searchText.value.get(e.id)?.includes(t))))
})
const syncTitle = computed(() => props.state.lastSync ? `Synced ${new Date(props.state.lastSync).toLocaleTimeString()}` : 'Sync')

function sorted(list: ItemView[]): ItemView[] {
	return [...list].sort((a, b) => a.item.title.localeCompare(b.item.title, undefined, { sensitivity: 'base' }))
}

function inCategory(entry: ItemView, c: Category): boolean {
	const item = entry.item
	switch (c) {
	case 'all': return true
	case 'favorites': return item.favorite
	case 'passkey': return item.type === 'login' && item.passkeys.length > 0
	default: return item.type === c
	}
}

const loginOf = (entry: ItemView): LoginItem | null => entry.item.type === 'login' ? entry.item : null
const subtitle = (entry: ItemView) => itemSubtitle(entry.item)
const initial = (title: string) => (title.trim()[0] ?? '?')

async function load(): Promise<void> {
	const [list, view] = await Promise.all([send('items'), send('site')])
	items.value = list
	site.value = view
	if (!view.url || (!view.logins.length && !view.hasCardFields && !view.hasIdentityFields)) {
		tab.value = 'vault'
	}
}

async function syncNow(): Promise<void> {
	syncing.value = true
	try {
		emit('update', await send('sync'))
		await load()
	} catch (e) {
		notice.value = `Sync failed: ${(e as Error).message}`
	} finally {
		syncing.value = false
	}
}

async function lockNow(): Promise<void> {
	emit('update', await send('lock'))
}

function openOptions(): void {
	void chrome.runtime.openOptionsPage()
}

async function copyTotp(itemId: string): Promise<void> {
	const { code } = await send('totp', { itemId })
	await copy(code, `t-${itemId}`)
}

async function totpSaved(itemId: string): Promise<void> {
	setupFor.value = null
	await load()
	selected.value = itemId
}

async function fill(itemId: string, force = false): Promise<void> {
	confirmFill.value = null
	notice.value = ''
	try {
		const result = await send('fill', { itemId, force })
		if (result.filled) {
			window.close()
		} else if (result.reason?.endsWith('?')) {
			confirmFill.value = { itemId, message: result.reason }
		} else {
			notice.value = result.reason ?? 'Nothing was filled.'
		}
	} catch (e) {
		notice.value = (e as Error).message
	}
}

onMounted(() => {
	load().catch((e) => {
		notice.value = (e as Error).message
	})
})
</script>

<style scoped>
.vault {
	display: flex;
	flex-direction: column;
	height: 100%;
}

.top {
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 8px 8px 4px 14px;
}

.brand {
	color: var(--primary);
}

.tabs {
	display: flex;
	gap: 4px;
	padding: 0 10px;
	border-bottom: 1px solid var(--border);
}

.tab {
	padding: 8px 10px;
	border: 0;
	border-bottom: 2px solid transparent;
	background: none;
	color: var(--text-muted);
	cursor: pointer;
	font-weight: 500;
}

.tab.active {
	color: var(--primary);
	border-bottom-color: var(--primary);
}

.body {
	flex: 1;
	overflow-y: auto;
	padding: 8px 10px 12px;
}

.section {
	margin: 10px 4px 4px;
	font-size: 12px;
	color: var(--text-muted);
	text-transform: uppercase;
	letter-spacing: 0.4px;
}

.title {
	display: block;
	font-weight: 500;
}

.grow > span {
	display: block;
}

.empty {
	padding: 40px 16px;
	text-align: center;
}

.empty-inline {
	padding: 8px 4px;
}

.search {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 0 10px;
	border: 1px solid var(--border);
	border-radius: var(--radius);
}

.search-input {
	flex: 1;
	min-height: 34px;
	border: 0;
	outline: none;
	background: none;
}

.chips {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin: 8px 0;
}

.chip {
	padding: 2px 10px;
	border: 1px solid var(--border);
	border-radius: 999px;
	background: var(--bg);
	font-size: 12px;
	cursor: pointer;
}

.chip.active {
	background: var(--primary-soft);
	border-color: var(--primary);
	color: var(--primary);
}

.star {
	color: #e8a300;
}

.spinning :deep(svg) {
	animation: spin 1s linear infinite;
}

.confirm, .notice, .sync-error {
	margin: 8px 10px 0;
}

.confirm {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
</style>
