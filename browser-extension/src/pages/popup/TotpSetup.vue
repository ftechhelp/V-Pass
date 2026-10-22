<template>
	<div class="setup" data-test="totp-setup">
		<div class="head">
			<button class="icon-btn" title="Back" @click="emit('back')"><ArrowLeftIcon :size="20" /></button>
			<h2 class="grow ellipsis">Set up a one-time code</h2>
		</div>

		<p v-if="scanning" class="row muted scanning"><span class="spinner" /> Looking for a QR code on the page…</p>

		<div v-else class="stack">
			<div v-if="scan" class="note row" data-test="totp-scan-result">
				<QrcodeIcon :size="22" class="found-icon" />
				<span class="grow">
					<strong class="ellipsis block">{{ scan.issuer || 'Authenticator QR code' }}</strong>
					<span v-if="scan.account" class="muted small ellipsis block">{{ scan.account }}</span>
				</span>
			</div>
			<template v-else>
				<p class="note warning" data-test="totp-scan-error">{{ scanError }}</p>
				<button class="btn" data-test="totp-rescan" @click="runScan">Scan again</button>
				<label class="field">
					<span>Or paste the setup key</span>
					<input v-model="pasted"
						class="input mono"
						:class="{ error: pastedInvalid }"
						placeholder="Secret key or otpauth:// link"
						autocomplete="off"
						spellcheck="false"
						data-test="totp-key">
				</label>
				<p v-if="pastedInvalid" class="error-text">This is not a valid setup key.</p>
			</template>

			<template v-if="key">
				<div>
					<h3 class="section">Save to</h3>
					<div class="search">
						<MagnifyIcon :size="18" class="muted" />
						<input v-model="query" class="search-input" placeholder="Search logins" data-test="totp-search">
					</div>
					<ul class="list" role="radiogroup">
						<li v-for="entry in choices" :key="entry.id">
							<button class="list-item"
								:class="{ selected: target === entry.id }"
								role="radio"
								:aria-checked="target === entry.id"
								:data-test="`totp-target-${entry.item.title}`"
								@click="target = entry.id">
								<span class="avatar">{{ initial(entry.item.title) }}</span>
								<span class="grow">
									<span class="ellipsis block title">{{ entry.item.title || '(untitled)' }}</span>
									<span class="ellipsis block muted small">{{ usernameOf(entry) || 'No username' }}</span>
								</span>
								<CheckIcon v-if="target === entry.id" :size="18" class="check-icon" />
							</button>
						</li>
						<li v-if="query && !choices.length" class="muted small empty">No logins match.</li>
						<li>
							<button class="list-item"
								:class="{ selected: target === NEW }"
								role="radio"
								:aria-checked="target === NEW"
								data-test="totp-target-new"
								@click="target = NEW">
								<span class="avatar"><PlusIcon :size="18" /></span>
								<span class="grow"><span class="ellipsis block title">New login</span></span>
								<CheckIcon v-if="target === NEW" :size="18" class="check-icon" />
							</button>
						</li>
					</ul>
				</div>

				<template v-if="target === NEW">
					<label class="field">
						<span>Title</span>
						<input v-model="newTitle" class="input" data-test="totp-new-title">
					</label>
					<label class="field">
						<span>Username</span>
						<input v-model="newUsername" class="input" autocomplete="off" data-test="totp-new-username">
					</label>
				</template>
				<p v-else-if="replaces" class="note warning small" data-test="totp-replaces">
					This replaces the one-time code saved in {{ replaces }}.
				</p>

				<p v-if="error" class="error-text">{{ error }}</p>
				<button class="btn primary wide" :disabled="!canSave" data-test="save-totp" @click="save">
					<span v-if="saving" class="spinner" />
					{{ saveLabel }}
				</button>
			</template>

			<p class="small muted moving">
				Moving from Google Authenticator or another app?
				<button class="btn link" data-test="open-import" @click="send('openImport')">Import 2FA codes</button>
			</p>
		</div>
	</div>
</template>

<script setup lang="ts">
import { type LoginItem, itemSearchText, parseTotp } from '@vpass/core'
import { computed, onMounted, ref, watch } from 'vue'
import ArrowLeftIcon from 'vue-material-design-icons/ArrowLeft.vue'
import CheckIcon from 'vue-material-design-icons/Check.vue'
import MagnifyIcon from 'vue-material-design-icons/Magnify.vue'
import PlusIcon from 'vue-material-design-icons/Plus.vue'
import QrcodeIcon from 'vue-material-design-icons/Qrcode.vue'
import type { ItemView, SiteView, TotpScan, TotpTarget } from '../../shared/protocol.ts'
import { send } from '../../shared/runtime.ts'

/**
 * Reads a site's 2FA QR code from the visible tab (in the background) and saves
 * the key to a login: one of this site's, any other, or a new one.
 */

const props = defineProps<{
	items: ItemView[]
	site: SiteView | null
	/** Login to preselect (opened from its details). */
	itemId: string | null
}>()
const emit = defineEmits<{ back: [], saved: [itemId: string] }>()

const NEW = 'new'
const scanning = ref(true)
const scan = ref<TotpScan | null>(null)
const scanError = ref('')
const pasted = ref('')
const query = ref('')
const target = ref<string | null>(null)
const newTitle = ref('')
const newUsername = ref('')
const saving = ref(false)
const error = ref('')

const logins = computed(() => props.items.filter((e) => e.item.type === 'login'))
const byId = computed(() => new Map(logins.value.map((e) => [e.id, e])))
/** The preselected login first, then this site's logins. */
const pinned = computed(() => {
	const ids = [props.itemId, ...(props.site?.logins ?? []).map((l) => l.id)].filter((id): id is string => !!id)
	return [...new Set(ids)].map((id) => byId.value.get(id)).filter((e): e is ItemView => !!e)
})
const choices = computed(() => {
	const terms = query.value.toLowerCase().split(/\s+/).filter(Boolean)
	if (!terms.length) {
		return pinned.value
	}
	return logins.value
		.filter((e) => { const text = itemSearchText(e.item); return terms.every((t) => text.includes(t)) })
		.sort((a, b) => a.item.title.localeCompare(b.item.title, undefined, { sensitivity: 'base' }))
		.slice(0, 20)
})

/** The key to save: the scanned one, or a valid pasted one. */
const key = computed<{ totp: string, issuer: string, account: string } | null>(() => {
	if (scan.value) {
		return scan.value
	}
	const text = pasted.value.trim()
	if (!text) {
		return null
	}
	try {
		const { issuer, account } = parseTotp(text)
		return { totp: text, issuer, account }
	} catch {
		return null
	}
})
const pastedInvalid = computed(() => !scan.value && !!pasted.value.trim() && !key.value)
const pageUrl = computed(() => scan.value?.url ?? props.site?.url ?? null)
const host = computed(() => pageUrl.value ? new URL(pageUrl.value).hostname.replace(/^www\./, '') : '')

const selected = computed(() => target.value && target.value !== NEW ? byId.value.get(target.value) ?? null : null)
const replaces = computed(() => selected.value && loginOf(selected.value)?.totp ? (selected.value.item.title || 'this login') : '')
const canSave = computed(() => !!key.value && !!target.value && !saving.value && (target.value !== NEW || !!newTitle.value.trim()))
const saveLabel = computed(() => {
	if (saving.value) return 'Saving…'
	if (target.value === NEW) return 'Save as a new login'
	return selected.value ? `Save to ${selected.value.item.title || '(untitled)'}` : 'Save'
})

const loginOf = (entry: ItemView): LoginItem | null => entry.item.type === 'login' ? entry.item : null
const usernameOf = (entry: ItemView) => loginOf(entry)?.username ?? null
const initial = (title: string) => (title.trim()[0] ?? '?')

// Defaults for a new login follow the key: the QR code's issuer and account.
watch(key, (k) => {
	newTitle.value = k?.issuer || host.value
	newUsername.value = k?.account ?? ''
})

function preselect(): void {
	if (target.value) {
		return
	}
	const site = pinned.value
	target.value = props.itemId ?? site.find((e) => !loginOf(e)?.totp)?.id ?? site[0]?.id ?? NEW
}

async function runScan(): Promise<void> {
	scanning.value = true
	scanError.value = ''
	scan.value = null
	try {
		scan.value = await send('scanQr')
	} catch (e) {
		scanError.value = (e as Error).message
	} finally {
		scanning.value = false
		preselect()
	}
}

async function save(): Promise<void> {
	const k = key.value
	if (!k || !target.value) {
		return
	}
	saving.value = true
	error.value = ''
	try {
		const into: TotpTarget = target.value === NEW
			? { newLogin: { title: newTitle.value, username: newUsername.value, url: pageUrl.value } }
			: { itemId: target.value }
		const { itemId } = await send('saveTotp', { totp: k.totp, into })
		emit('saved', itemId)
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		saving.value = false
	}
}

onMounted(runScan)
</script>

<style scoped>
.head {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 8px;
}

.scanning {
	padding: 24px 8px;
}

.found-icon, .check-icon {
	color: var(--primary);
	flex: none;
}

.block {
	display: block;
}

.title {
	font-weight: 500;
}

.mono {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.section {
	margin: 0 4px 6px;
	font-size: 12px;
	color: var(--text-muted);
	text-transform: uppercase;
	letter-spacing: 0.4px;
}

.search {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 4px;
	padding: 0 10px;
	border: 1px solid var(--border);
	border-radius: var(--radius);
}

.search-input {
	flex: 1;
	min-height: 32px;
	border: 0;
	outline: none;
	background: none;
}

.empty {
	padding: 8px 10px;
}

.moving {
	margin-top: 8px;
}
</style>
