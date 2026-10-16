<template>
	<form class="stack" data-test="unlock-form" @submit.prevent="submit">
		<div class="stack unlock-head">
			<ShieldLockIcon :size="44" class="unlock-icon" />
			<h1>Unlock V-Pass</h1>
			<p v-if="user" class="muted small ellipsis">{{ user }} · {{ host }}</p>
		</div>
		<label class="field">
			<span>Master password</span>
			<div class="row">
				<input ref="input"
					v-model="password"
					:type="reveal ? 'text' : 'password'"
					class="input grow"
					:class="{ error: !!error }"
					autocomplete="current-password"
					data-test="master-password"
					:disabled="busy"
					autofocus>
				<button type="button" class="icon-btn" :title="reveal ? 'Hide' : 'Show'" @click="reveal = !reveal">
					<EyeOffIcon v-if="reveal" :size="18" />
					<EyeIcon v-else :size="18" />
				</button>
			</div>
		</label>
		<p v-if="error" class="error-text" data-test="unlock-error">{{ error }}</p>
		<label class="check">
			<input v-model="keep" type="checkbox" data-test="keep-unlocked">
			<span>Keep unlocked on this device</span>
		</label>
		<p v-if="keep" class="note warning small" data-test="keep-unlocked-warning">
			V-Pass will stay unlocked, even after Chrome restarts, until you lock it. Anyone who can use this
			computer account or copy your Chrome profile could then open your vault without the master password.
			Only turn this on for a device that only you use.
		</p>
		<button class="btn primary wide" type="submit" :disabled="!password || busy" data-test="unlock-submit">
			<span v-if="busy" class="spinner" />
			{{ busy ? 'Unlocking…' : 'Unlock' }}
		</button>
	</form>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import EyeIcon from 'vue-material-design-icons/Eye.vue'
import EyeOffIcon from 'vue-material-design-icons/EyeOff.vue'
import ShieldLockIcon from 'vue-material-design-icons/ShieldLock.vue'
import type { ExtensionState } from '../../shared/protocol.ts'
import { send } from '../../shared/runtime.ts'

const props = defineProps<{
	user: string | null
	server: string | null
	keepUnlocked: boolean
}>()

const emit = defineEmits<{ unlocked: [state: ExtensionState] }>()

const input = ref<HTMLInputElement>()
const password = ref('')
const keep = ref(props.keepUnlocked)
const reveal = ref(false)
const busy = ref(false)
const error = ref('')
const host = computed(() => props.server ? new URL(props.server).host : '')

onMounted(() => input.value?.focus())

async function submit(): Promise<void> {
	busy.value = true
	error.value = ''
	try {
		const state = await send('unlock', { password: password.value, keepUnlocked: keep.value })
		password.value = ''
		emit('unlocked', state)
	} catch (e) {
		const err = e as Error
		error.value = err.name === 'WrongPasswordError' ? 'That master password is not correct.' : err.message
		password.value = ''
		input.value?.focus()
	} finally {
		busy.value = false
	}
}
</script>

<style scoped>
.unlock-head {
	align-items: center;
	text-align: center;
	gap: 6px;
}

.unlock-icon {
	color: var(--primary);
}
</style>
