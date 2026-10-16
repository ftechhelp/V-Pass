<template>
	<div class="prompt">
		<div v-if="loading" class="center"><span class="spinner" /></div>
		<p v-else-if="error" class="note error">{{ error }}</p>

		<!-- Connect, asked by the V-Pass web app's "Browser extension" page -->
		<div v-else-if="connectServer" class="stack" data-test="connect-confirm">
			<div class="stack head">
				<ShieldLockIcon :size="40" class="brand" />
				<h1>Connect V-Pass?</h1>
				<p class="muted">to <b>{{ connectHost }}</b></p>
			</div>
			<p v-if="state && state.status !== 'disconnected' && state.status !== 'connecting'" class="note">
				V-Pass is already connected to {{ state.server }}.
			</p>
			<template v-else>
				<p>V-Pass opens Nextcloud's sign-in page for this server. Choose <b>Grant access</b> there, then unlock V-Pass from the toolbar.</p>
				<p class="muted small">Only continue if you just clicked "Connect this browser" in V-Pass on {{ connectHost }}.</p>
				<button class="btn primary wide" :disabled="busy" data-test="connect-confirm-button" @click="confirmConnect">
					<span v-if="busy" class="spinner" /> Connect
				</button>
			</template>
			<button class="btn link" @click="closeWindow">Cancel</button>
		</div>

		<!-- Unlock (standalone, or before answering a passkey request) -->
		<UnlockForm v-else-if="needsUnlock && state" :user="state.user" :server="state.server" :keep-unlocked="state.keepUnlocked" @unlocked="afterUnlock" />

		<template v-else-if="details">
			<div class="stack head">
				<FingerprintIcon :size="40" class="brand" />
				<h1 v-if="details.kind === 'create'">Save a passkey?</h1>
				<h1 v-else>Sign in with a passkey</h1>
				<p class="muted"><b>{{ details.rpName }}</b> · {{ host }}</p>
			</div>

			<!-- create -->
			<template v-if="details.kind === 'create'">
				<template v-if="details.excluded">
					<p class="note">A passkey for this account is already saved in V-Pass.</p>
					<button class="btn primary wide" @click="decide({ action: 'save', itemId: null })">OK</button>
				</template>
				<template v-else>
					<p v-if="details.userName" class="muted small center-text">For <b>{{ details.userName }}</b></p>
					<p class="small muted">Save it to:</p>
					<ul class="list targets">
						<li>
							<label class="list-item">
								<input v-model="target" type="radio" :value="NEW_LOGIN" data-test="passkey-target-new">
								<span class="grow"><span class="title">A new login</span><span class="muted small">{{ details.rpName }}</span></span>
							</label>
						</li>
						<li v-for="c in details.candidates" :key="c.id">
							<label class="list-item">
								<input v-model="target" type="radio" :value="c.id">
								<span class="grow"><span class="title ellipsis">{{ c.title }}</span><span class="muted small ellipsis">{{ c.username || 'No username' }}</span></span>
							</label>
						</li>
					</ul>
					<button class="btn primary wide" :disabled="busy" data-test="passkey-save" @click="decide({ action: 'save', itemId: target === NEW_LOGIN ? null : target })">
						<span v-if="busy" class="spinner" /> Save passkey in V-Pass
					</button>
				</template>
			</template>

			<!-- get -->
			<template v-else>
				<ul v-if="details.candidates.length" class="list targets">
					<li v-for="c in details.candidates" :key="`${c.id}:${c.credentialId}`">
						<button class="list-item" :disabled="busy" data-test="passkey-use" @click="decide({ action: 'use', itemId: c.id, credentialId: c.credentialId! })">
							<span class="avatar">{{ (c.title.trim()[0] ?? '?') }}</span>
							<span class="grow"><span class="title ellipsis">{{ c.username || c.title }}</span><span class="muted small ellipsis">{{ c.title }}</span></span>
						</button>
					</li>
				</ul>
				<p v-else class="note">V-Pass has no passkey for {{ details.rpName }}.</p>
			</template>

			<div class="stack actions">
				<button class="btn wide" :disabled="busy" data-test="passkey-fallback" @click="decide({ action: 'fallback' })">Use another device or security key</button>
				<button class="btn link" :disabled="busy" @click="decide({ action: 'cancel' })">Cancel</button>
			</div>
		</template>
	</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import FingerprintIcon from 'vue-material-design-icons/Fingerprint.vue'
import ShieldLockIcon from 'vue-material-design-icons/ShieldLock.vue'
import type { ExtensionState, Fido2Decision, Fido2Details } from '../../shared/protocol.ts'
import { send } from '../../shared/runtime.ts'
import UnlockForm from '../ui/UnlockForm.vue'

const NEW_LOGIN = '__new__'
const hash = location.hash.slice(1)
const unlockOnly = hash === 'unlock'
const connectServer = hash.startsWith('connect=') ? decodeURIComponent(hash.slice('connect='.length)) : null
const connectHost = connectServer ? new URL(connectServer).host : ''

const loading = ref(true)
const error = ref('')
const state = ref<ExtensionState | null>(null)
const details = ref<Fido2Details | null>(null)
const target = ref(NEW_LOGIN)
const busy = ref(false)
const needsUnlock = computed(() => !connectServer && (unlockOnly || state.value?.status !== 'unlocked'))
const host = computed(() => details.value ? new URL(details.value.origin).host : '')
let heartbeat: ReturnType<typeof setInterval> | undefined

async function load(): Promise<void> {
	loading.value = true
	try {
		state.value = await send('state')
		if (connectServer) {
			return
		}
		if (state.value.status === 'disconnected' || state.value.status === 'connecting') {
			error.value = 'Connect V-Pass to your Nextcloud first (click the V-Pass toolbar icon).'
			return
		}
		if (!unlockOnly) {
			details.value = await send('fido2Details', { requestId: hash })
			const sameUser = details.value.candidates.find((c) => c.username && c.username === details.value?.userName)
			target.value = sameUser?.id ?? NEW_LOGIN
		}
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		loading.value = false
	}
}

async function afterUnlock(next: ExtensionState): Promise<void> {
	state.value = next
	if (unlockOnly) {
		window.close()
		return
	}
	await load()
}

function closeWindow(): void {
	window.close()
}

async function confirmConnect(): Promise<void> {
	busy.value = true
	try {
		await send('connect', { server: connectServer! })
		window.close()
	} catch (e) {
		error.value = (e as Error).message
		busy.value = false
	}
}

async function decide(decision: Fido2Decision): Promise<void> {
	busy.value = true
	try {
		await send('fido2Decide', { requestId: hash, decision })
		window.close()
	} catch (e) {
		error.value = (e as Error).message
		busy.value = false
	}
}

onMounted(() => {
	void load()
	// Keeps the service worker awake while the user decides.
	heartbeat = setInterval(() => send('heartbeat').catch(() => {}), 10_000)
})
onBeforeUnmount(() => clearInterval(heartbeat))
</script>

<style scoped>
.prompt {
	max-width: 440px;
	margin: 0 auto;
	padding: 20px;
}

.head {
	align-items: center;
	text-align: center;
	gap: 6px;
	margin-bottom: 14px;
}

.brand {
	color: var(--primary);
}

.center {
	display: flex;
	justify-content: center;
	padding: 60px 0;
}

.center-text {
	text-align: center;
	margin-bottom: 8px;
}

.targets {
	margin: 6px 0 14px;
	max-height: 260px;
	overflow-y: auto;
}

.targets input {
	accent-color: var(--primary);
}

.title {
	display: block;
	font-weight: 500;
}

.grow > span {
	display: block;
}

.actions {
	margin-top: 10px;
	gap: 6px;
	align-items: stretch;
}
</style>
