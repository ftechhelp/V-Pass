<template>
	<div v-if="settings" class="stack generator">
		<div class="value-box">
			<code class="value" data-test="generated">{{ value }}</code>
			<button class="icon-btn" title="Generate another" @click="regenerate"><RefreshIcon :size="18" /></button>
		</div>
		<p v-if="error" class="error-text">{{ error }}</p>
		<div class="row">
			<button class="btn primary grow" :disabled="!value" @click="copy(value, 'generated')">
				<CheckIcon v-if="copied === 'generated'" :size="18" />
				<ContentCopyIcon v-else :size="18" />
				Copy
			</button>
			<button class="btn grow" :disabled="!value" @click="fillIntoPage">Fill on page</button>
		</div>
		<p v-if="notice" class="muted small">{{ notice }}</p>

		<div class="segmented">
			<button :class="{ active: settings.mode === 'password' }" @click="settings.mode = 'password'">Password</button>
			<button :class="{ active: settings.mode === 'passphrase' }" @click="settings.mode = 'passphrase'">Passphrase</button>
		</div>

		<template v-if="settings.mode === 'password'">
			<label class="field">
				<span>Length: {{ settings.password.length }}</span>
				<input v-model.number="settings.password.length" type="range" :min="PASSWORD_LENGTH_RANGE.min" :max="64">
			</label>
			<label class="check"><input v-model="settings.password.uppercase" type="checkbox"> A–Z</label>
			<label class="check"><input v-model="settings.password.lowercase" type="checkbox"> a–z</label>
			<label class="check"><input v-model="settings.password.digits" type="checkbox"> 0–9</label>
			<label class="check"><input v-model="settings.password.symbols" type="checkbox"> !@#$%</label>
			<label class="check"><input v-model="settings.password.avoidAmbiguous" type="checkbox"> Avoid look-alike characters</label>
		</template>
		<template v-else>
			<label class="field">
				<span>Words: {{ settings.passphrase.words }}</span>
				<input v-model.number="settings.passphrase.words" type="range" :min="PASSPHRASE_WORDS_RANGE.min" :max="12">
			</label>
			<label class="field">
				<span>Separator</span>
				<input v-model="settings.passphrase.separator" class="input" maxlength="3">
			</label>
			<label class="check"><input v-model="settings.passphrase.capitalize" type="checkbox"> Capitalize words</label>
			<label class="check"><input v-model="settings.passphrase.includeNumber" type="checkbox"> Include a number</label>
		</template>
	</div>
</template>

<script setup lang="ts">
import { PASSPHRASE_WORDS_RANGE, PASSWORD_LENGTH_RANGE, generatePassphrase, generatePassword } from '@vpass/core'
import { onMounted, ref, watch } from 'vue'
import CheckIcon from 'vue-material-design-icons/Check.vue'
import ContentCopyIcon from 'vue-material-design-icons/ContentCopy.vue'
import RefreshIcon from 'vue-material-design-icons/Refresh.vue'
import { send } from '../../shared/runtime.ts'
import type { GeneratorSettings } from '../../shared/settings.ts'
import { useCopy } from '../ui/copy.ts'

const settings = ref<GeneratorSettings | null>(null)
const value = ref('')
const error = ref('')
const notice = ref('')
const { copied, copy } = useCopy()

function regenerate(): void {
	if (!settings.value) return
	try {
		value.value = settings.value.mode === 'password' ? generatePassword(settings.value.password) : generatePassphrase(settings.value.passphrase)
		error.value = ''
	} catch (e) {
		value.value = ''
		error.value = (e as Error).message
	}
}

async function fillIntoPage(): Promise<void> {
	const filled = await send('fillGenerated', { password: value.value })
	if (filled) {
		window.close()
	} else {
		notice.value = 'Click into a password field on the page first, then try again (or copy it).'
	}
}

onMounted(async () => {
	settings.value = (await send('getSettings')).generator
	regenerate()
	watch(settings, (next) => {
		regenerate()
		if (next) send('setSettings', { patch: { generator: next } }).catch(() => {})
	}, { deep: true })
})
</script>

<style scoped>
.generator {
	padding: 4px 2px;
}

.value-box {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 10px 12px;
	border-radius: var(--radius);
	background: var(--bg-soft);
}

.value {
	flex: 1;
	overflow-wrap: anywhere;
	font-size: 15px;
}

.segmented {
	display: flex;
	border: 1px solid var(--border);
	border-radius: var(--radius);
	overflow: hidden;
}

.segmented button {
	flex: 1;
	padding: 6px;
	border: 0;
	background: var(--bg);
	cursor: pointer;
}

.segmented button.active {
	background: var(--primary-soft);
	color: var(--primary);
	font-weight: 600;
}

input[type=range] {
	accent-color: var(--primary);
}
</style>
