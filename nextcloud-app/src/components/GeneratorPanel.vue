<template>
	<div class="generator">
		<div class="generator__output" :class="{ 'generator__output--error': !!error }">
			<span class="generator__value" data-test="generated-value">{{ error || value }}</span>
			<NcButton variant="tertiary" :aria-label="t('vpass', 'Generate again')" :title="t('vpass', 'Generate again')" @click="regenerate">
				<template #icon>
					<RefreshIcon :size="20" />
				</template>
			</NcButton>
			<NcButton variant="tertiary"
				:disabled="!!error"
				:aria-label="t('vpass', 'Copy password')"
				:title="t('vpass', 'Copy')"
				@click="copyToClipboard(value, t('vpass', 'Password'))">
				<template #icon>
					<ContentCopyIcon :size="20" />
				</template>
			</NcButton>
		</div>
		<StrengthMeter v-if="!error" :password="value" />

		<div class="generator__modes" role="radiogroup" :aria-label="t('vpass', 'Type')">
			<NcCheckboxRadioSwitch v-model="mode" type="radio" value="password" button-variant button-variant-grouped="horizontal" name="generator-mode">
				{{ t('vpass', 'Password') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch v-model="mode" type="radio" value="passphrase" button-variant button-variant-grouped="horizontal" name="generator-mode">
				{{ t('vpass', 'Passphrase') }}
			</NcCheckboxRadioSwitch>
		</div>

		<template v-if="mode === 'password'">
			<label class="generator__slider">
				<span>{{ t('vpass', 'Length: {n}', { n: passwordOpts.length }) }}</span>
				<input v-model.number="passwordOpts.length" type="range" :min="8" :max="64" step="1">
			</label>
			<NcCheckboxRadioSwitch v-model="passwordOpts.uppercase" type="switch">
				{{ t('vpass', 'Uppercase letters (A–Z)') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch v-model="passwordOpts.lowercase" type="switch">
				{{ t('vpass', 'Lowercase letters (a–z)') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch v-model="passwordOpts.digits" type="switch">
				{{ t('vpass', 'Numbers (0–9)') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch v-model="passwordOpts.symbols" type="switch">
				{{ t('vpass', 'Symbols (!@#…)') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch v-model="passwordOpts.avoidAmbiguous" type="switch">
				{{ t('vpass', 'Avoid look-alike characters (l, 1, O, 0)') }}
			</NcCheckboxRadioSwitch>
		</template>
		<template v-else>
			<label class="generator__slider">
				<span>{{ t('vpass', 'Words: {n}', { n: phraseOpts.words }) }}</span>
				<input v-model.number="phraseOpts.words" type="range" :min="3" :max="12" step="1">
			</label>
			<NcTextField v-model="phraseOpts.separator" :label="t('vpass', 'Separator')" :maxlength="3" />
			<NcCheckboxRadioSwitch v-model="phraseOpts.capitalize" type="switch">
				{{ t('vpass', 'Capitalize words') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch v-model="phraseOpts.includeNumber" type="switch">
				{{ t('vpass', 'Include a number') }}
			</NcCheckboxRadioSwitch>
		</template>

		<NcButton v-if="useLabel" variant="primary" wide :disabled="!!error" @click="emit('use', value)">
			<template #icon>
				<CheckIcon :size="20" />
			</template>
			{{ useLabel }}
		</NcButton>
	</div>
</template>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import {
	DEFAULT_PASSPHRASE_OPTIONS,
	DEFAULT_PASSWORD_OPTIONS,
	generatePassphrase,
	generatePassword,
} from '@vpass/core'
import { reactive, ref, watch } from 'vue'
import CheckIcon from 'vue-material-design-icons/Check.vue'
import ContentCopyIcon from 'vue-material-design-icons/ContentCopy.vue'
import RefreshIcon from 'vue-material-design-icons/Refresh.vue'
import { copyToClipboard } from '../services/browser.ts'
import StrengthMeter from './StrengthMeter.vue'

defineProps<{
	/** When set, shows a button that emits `use` with the generated value. */
	useLabel?: string
}>()

const emit = defineEmits<{ use: [value: string] }>()

const STORAGE_KEY = 'vpass:generator'

function loadSettings() {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
	} catch {
		return {}
	}
}

const saved = loadSettings()
const mode = ref<'password' | 'passphrase'>(saved.mode === 'passphrase' ? 'passphrase' : 'password')
const passwordOpts = reactive({ ...DEFAULT_PASSWORD_OPTIONS, ...saved.password })
const phraseOpts = reactive({ ...DEFAULT_PASSPHRASE_OPTIONS, ...saved.passphrase })
const value = ref('')
const error = ref('')

function regenerate(): void {
	try {
		value.value = mode.value === 'password' ? generatePassword(passwordOpts) : generatePassphrase(phraseOpts)
		error.value = ''
	} catch (e) {
		value.value = ''
		error.value = (e as Error).message
	}
}

watch([mode, passwordOpts, phraseOpts], () => {
	regenerate()
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: mode.value, password: passwordOpts, passphrase: phraseOpts }))
	} catch {
		// ignore
	}
}, { deep: true, immediate: true })
</script>

<style scoped lang="scss">
.generator {
	display: flex;
	flex-direction: column;
	gap: 10px;

	&__output {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 8px 8px 8px 14px;
		border: 2px solid var(--color-border-maxcontrast);
		border-radius: var(--border-radius-large);
		background: var(--color-background-dark);

		&--error {
			border-color: var(--color-error);
		}
	}

	&__value {
		flex: 1;
		font-family: var(--font-face-monospace, monospace);
		font-size: 1.15em;
		overflow-wrap: anywhere;
	}

	&__modes {
		display: flex;
	}

	&__slider {
		display: flex;
		flex-direction: column;
		gap: 4px;

		input {
			width: 100%;
		}
	}
}
</style>
