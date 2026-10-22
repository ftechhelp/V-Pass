<template>
	<div class="options">
		<header class="logo"><ShieldLockIcon :size="28" class="brand" /> V-Pass settings</header>
		<p v-if="error" class="note error">{{ error }}</p>

		<section v-if="state" class="card stack">
			<h2>Account</h2>
			<template v-if="state.server">
				<p>Connected to <b>{{ host }}</b> as <b>{{ state.user }}</b>.</p>
				<p class="muted small">V-Pass uses an app password for this browser. You can also revoke it in Nextcloud under Settings → Security.</p>
				<div class="row">
					<button class="btn" @click="send('openWebVault')">Open V-Pass on Nextcloud</button>
					<button class="btn danger" data-test="disconnect" @click="disconnect">Disconnect</button>
				</div>
			</template>
			<p v-else class="muted">Not connected. Click the V-Pass toolbar icon to connect to your Nextcloud.</p>
		</section>

		<section v-if="settings && state" class="card stack">
			<h2>Security</h2>
			<label class="field">
				<span>Lock V-Pass after the computer is idle for</span>
				<select v-model.number="settings.autoLockMinutes" class="input" :disabled="keepUnlockedActive">
					<option :value="1">1 minute</option>
					<option :value="5">5 minutes</option>
					<option :value="15">15 minutes</option>
					<option :value="30">30 minutes</option>
					<option :value="60">1 hour</option>
					<option :value="240">4 hours</option>
					<option :value="0">Never (only when Chrome closes)</option>
				</select>
			</label>
			<label class="check">
				<input v-model="settings.lockOnSystemLock" type="checkbox" :disabled="keepUnlockedActive">
				<span>Lock when the computer locks or goes to sleep</span>
			</label>
			<label class="check">
				<input :checked="keepUnlockedActive" type="checkbox" :disabled="state.status !== 'unlocked'" data-test="options-keep-unlocked" @change="toggleKeepUnlocked(($event.target as HTMLInputElement).checked)">
				<span>
					Keep unlocked on this device
					<span v-if="state.status !== 'unlocked' && !keepUnlockedActive" class="muted small block">Unlock V-Pass to change this.</span>
				</span>
			</label>
			<p v-if="keepUnlockedActive" class="note warning small">
				V-Pass stays unlocked across restarts until you lock it, and the automatic locks above are off. Anyone who
				can use this computer account or copy your Chrome profile could open your vault without the master password.
			</p>
			<label class="field">
				<span>Clear copied passwords from the clipboard after</span>
				<select v-model.number="settings.clipboardClearSeconds" class="input">
					<option :value="15">15 seconds</option>
					<option :value="30">30 seconds</option>
					<option :value="60">1 minute</option>
					<option :value="120">2 minutes</option>
					<option :value="0">Never</option>
				</select>
			</label>
		</section>

		<section v-if="settings" class="card stack">
			<h2>Autofill</h2>
			<label class="check">
				<input v-model="settings.inlineMenu" type="checkbox">
				<span>Show the V-Pass menu in login, card and address fields</span>
			</label>
			<label class="check">
				<input v-model="settings.offerToSave" type="checkbox">
				<span>Offer to save new logins and update changed passwords</span>
			</label>
			<div v-if="neverSave.length" class="stack never">
				<p class="small muted">Never offer to save on:</p>
				<div v-for="host in neverSave" :key="host" class="row">
					<span class="grow">{{ host }}</span>
					<button class="btn link" @click="removeNever(host)">Remove</button>
				</div>
			</div>
			<p class="small muted">
				Shortcuts: <b>Ctrl+Shift+L</b> fills the best login, <b>Ctrl+Shift+9</b> generates a password, <b>Ctrl+Shift+Y</b> opens V-Pass.
				<button class="btn link" @click="openShortcuts">Change shortcuts</button>
			</p>
		</section>

		<section v-if="settings" class="card stack">
			<h2>Passkeys</h2>
			<label class="check">
				<input v-model="settings.passkeyProvider" type="checkbox" data-test="passkey-provider">
				<span>Use V-Pass for passkeys on websites</span>
			</label>
			<p class="small muted">
				When a site asks to create or use a passkey, V-Pass offers to save it in your vault or sign in with a saved one.
				You can always choose "Use another device or security key" to use Chrome's own passkeys instead.
			</p>
		</section>

		<section v-if="state?.server" class="card stack">
			<h2>2FA codes</h2>
			<p class="small muted">
				Move your one-time codes from Google Authenticator, Aegis, 2FAS, Ente Auth or Bitwarden Authenticator into your logins.
			</p>
			<div><button class="btn" data-test="open-import" @click="send('openImport')">Import 2FA codes</button></div>
		</section>

		<p class="muted small about">V-Pass {{ version }} · end-to-end encrypted: your master password and vault key never leave this browser.</p>
	</div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import ShieldLockIcon from 'vue-material-design-icons/ShieldLock.vue'
import type { ExtensionState } from '../../shared/protocol.ts'
import { send } from '../../shared/runtime.ts'
import type { Settings } from '../../shared/settings.ts'

const state = ref<ExtensionState | null>(null)
const settings = ref<Settings | null>(null)
const neverSave = ref<string[]>([])
const error = ref('')
const version = chrome.runtime.getManifest().version
const host = computed(() => state.value?.server ? new URL(state.value.server).host : '')
const keepUnlockedActive = computed(() => state.value?.status === 'unlocked' && state.value.keepUnlocked)

async function load(): Promise<void> {
	try {
		;[state.value, settings.value, neverSave.value] = await Promise.all([send('state'), send('getSettings'), send('neverSaveList')])
		watch(settings, (next) => {
			if (next) send('setSettings', { patch: next }).catch((e) => {
				error.value = (e as Error).message
			})
		}, { deep: true })
	} catch (e) {
		error.value = (e as Error).message
	}
}

async function toggleKeepUnlocked(value: boolean): Promise<void> {
	if (value && !confirm('Keep V-Pass unlocked on this device?\n\nIt will stay unlocked even after Chrome restarts, until you lock it. Anyone who can use this computer account or copy your Chrome profile could open your vault without your master password.\n\nOnly do this on a device that only you use.')) {
		state.value = { ...state.value! }
		return
	}
	state.value = await send('setKeepUnlocked', { value })
}

async function disconnect(): Promise<void> {
	if (!confirm('Disconnect V-Pass from Nextcloud? This browser forgets the app password and the cached (encrypted) vault. Your vault on Nextcloud is not affected.')) {
		return
	}
	state.value = await send('disconnect')
}

async function removeNever(host: string): Promise<void> {
	neverSave.value = await send('removeNeverSave', { host })
}

function openShortcuts(): void {
	void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
}

onMounted(() => void load())
</script>

<style scoped>
.options {
	max-width: 640px;
	margin: 0 auto;
	padding: 32px 20px 60px;
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.brand {
	color: var(--primary);
}

.logo {
	font-size: 20px;
	margin-bottom: 8px;
}

.card {
	padding: 18px 20px;
	border: 1px solid var(--border);
	border-radius: 12px;
}

.block {
	display: block;
}

.never {
	gap: 4px;
}

.about {
	text-align: center;
}
</style>
