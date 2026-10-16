<template>
	<div class="stack pad">
		<div class="logo"><ShieldLockIcon :size="28" class="brand" /> V-Pass</div>
		<template v-if="state.status === 'connecting'">
			<h2>Finish signing in</h2>
			<p class="muted">
				Sign in to Nextcloud in the tab that just opened and choose <b>Grant access</b>.
				V-Pass connects as soon as you do.
			</p>
			<div class="row"><span class="spinner" /><span class="muted small">Waiting for Nextcloud…</span></div>
			<div class="row">
				<button class="btn" @click="reopen">Open sign-in tab again</button>
				<button class="btn link" @click="cancel">Cancel</button>
			</div>
		</template>
		<form v-else class="stack" @submit.prevent="connect">
			<h2>Connect to your Nextcloud</h2>
			<p class="muted small">
				V-Pass uses the vault you created in the V-Pass app on Nextcloud. Your passwords are decrypted
				only here, with your master password.
			</p>
			<label class="field">
				<span>Nextcloud address</span>
				<input v-model="server" class="input" placeholder="cloud.example.com" data-test="server-url" autofocus>
			</label>
			<p v-if="error" class="error-text">{{ error }}</p>
			<button class="btn primary wide" type="submit" :disabled="!server.trim() || busy" data-test="connect">
				<span v-if="busy" class="spinner" /> Connect
			</button>
		</form>
	</div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ShieldLockIcon from 'vue-material-design-icons/ShieldLock.vue'
import type { ExtensionState } from '../../shared/protocol.ts'
import { send } from '../../shared/runtime.ts'

const props = defineProps<{ state: ExtensionState }>()
const emit = defineEmits<{ update: [state: ExtensionState] }>()

const server = ref('')
const busy = ref(false)
const error = ref('')
let poll: ReturnType<typeof setInterval> | undefined

async function connect(): Promise<void> {
	busy.value = true
	error.value = ''
	try {
		emit('update', await send('connect', { server: server.value }))
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		busy.value = false
	}
}

async function cancel(): Promise<void> {
	emit('update', await send('cancelConnect'))
}

function reopen(): void {
	if (props.state.loginUrl) {
		void chrome.tabs.create({ url: props.state.loginUrl })
	}
}

onMounted(() => {
	poll = setInterval(async () => {
		if (props.state.status !== 'connecting') return
		const next = await send('state').catch(() => null)
		if (next && next.status !== 'connecting') emit('update', next)
	}, 2000)
})
onBeforeUnmount(() => clearInterval(poll))
</script>

<style scoped>
.pad {
	padding: 20px;
}

.brand {
	color: var(--primary);
}
</style>
