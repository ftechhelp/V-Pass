<template>
	<div v-if="value" class="field-row">
		<div class="grow">
			<div class="label">{{ label }}</div>
			<div class="value" :class="{ mono: secret || mono, multiline }">
				<slot>{{ secret && !revealed ? '•'.repeat(Math.min(value.length, 16)) : value }}</slot>
			</div>
		</div>
		<button v-if="secret" class="icon-btn" :title="revealed ? 'Hide' : 'Show'" @click="revealed = !revealed">
			<EyeOffIcon v-if="revealed" :size="18" />
			<EyeIcon v-else :size="18" />
		</button>
		<button class="icon-btn" :title="`Copy ${label.toLowerCase()}`" @click="copy(copyValue ?? value, label)">
			<CheckIcon v-if="copied === label" :size="18" />
			<ContentCopyIcon v-else :size="18" />
		</button>
	</div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import CheckIcon from 'vue-material-design-icons/Check.vue'
import ContentCopyIcon from 'vue-material-design-icons/ContentCopy.vue'
import EyeIcon from 'vue-material-design-icons/Eye.vue'
import EyeOffIcon from 'vue-material-design-icons/EyeOff.vue'
import { useCopy } from '../ui/copy.ts'

defineProps<{
	label: string
	value: string
	/** Value to copy when it differs from what is shown (e.g. a TOTP code). */
	copyValue?: string
	secret?: boolean
	mono?: boolean
	multiline?: boolean
}>()

const revealed = ref(false)
const { copied, copy } = useCopy()
</script>

<style scoped>
.field-row {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 6px 4px;
	border-bottom: 1px solid var(--border);
}

.label {
	font-size: 12px;
	color: var(--text-muted);
}

.value {
	overflow-wrap: anywhere;
}

.mono {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.multiline {
	white-space: pre-wrap;
}
</style>
