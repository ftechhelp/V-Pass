<template>
	<div class="popup" :class="{ tall: state?.status === 'unlocked' }">
		<div v-if="!state" class="center"><span class="spinner" /></div>
		<p v-else-if="loadError" class="note error">{{ loadError }}</p>
		<ConnectView v-else-if="state.status === 'disconnected' || state.status === 'connecting'" :state="state" @update="state = $event" />
		<div v-else-if="state.noVault" class="stack pad">
			<h1>No vault yet</h1>
			<p class="muted">{{ state.user }} doesn't have a V-Pass vault. Create it in the V-Pass web app on {{ host }}, then come back here.</p>
			<button class="btn primary" @click="send('openWebVault')">Open V-Pass on Nextcloud</button>
			<button class="btn" @click="refresh(true)">Check again</button>
		</div>
		<div v-else-if="state.status === 'locked'" class="pad">
			<UnlockForm :user="state.user" :server="state.server" :keep-unlocked="state.keepUnlocked" @unlocked="state = $event" />
		</div>
		<VaultView v-else :state="state" @update="state = $event" />
	</div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ExtensionState } from '../../shared/protocol.ts'
import { send } from '../../shared/runtime.ts'
import UnlockForm from '../ui/UnlockForm.vue'
import ConnectView from './ConnectView.vue'
import VaultView from './VaultView.vue'

const state = ref<ExtensionState | null>(null)
const loadError = ref('')
const host = computed(() => state.value?.server ? new URL(state.value.server).host : '')

async function refresh(syncFirst = false): Promise<void> {
	try {
		state.value = syncFirst ? await send('sync').catch(() => send('state')) : await send('state')
		loadError.value = ''
	} catch (e) {
		loadError.value = (e as Error).message
	}
}

onMounted(() => void refresh())
</script>

<style scoped>
.popup {
	width: 380px;
	min-height: 200px;
}

.popup.tall {
	height: 580px;
}

.pad {
	padding: 20px;
}

.center {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 200px;
}
</style>
