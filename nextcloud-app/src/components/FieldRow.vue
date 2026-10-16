<template>
	<div v-if="value || $slots.default" class="field-row">
		<div class="field-row__content">
			<div class="field-row__label">
				{{ label }}
			</div>
			<div class="field-row__value" :class="{ 'field-row__value--mono': monospace || (secret && revealed), 'field-row__value--multiline': multiline }">
				<slot>
					<template v-if="secret && !revealed">
						••••••••••••
					</template>
					<a v-else-if="href" :href="href" target="_blank" rel="noopener noreferrer nofollow">{{ display }}</a>
					<template v-else>
						{{ display }}
					</template>
				</slot>
			</div>
		</div>
		<div class="field-row__actions">
			<NcButton v-if="secret"
				variant="tertiary"
				:aria-label="revealed ? t('vpass', 'Hide {label}', { label }) : t('vpass', 'Show {label}', { label })"
				:title="revealed ? t('vpass', 'Hide') : t('vpass', 'Show')"
				@click="revealed = !revealed">
				<template #icon>
					<EyeOffIcon v-if="revealed" :size="20" />
					<EyeIcon v-else :size="20" />
				</template>
			</NcButton>
			<NcButton v-if="href"
				variant="tertiary"
				:href="href"
				target="_blank"
				:aria-label="t('vpass', 'Open {label}', { label })"
				:title="t('vpass', 'Open')">
				<template #icon>
					<OpenInNewIcon :size="20" />
				</template>
			</NcButton>
			<NcButton v-if="copyable"
				variant="tertiary"
				:aria-label="t('vpass', 'Copy {label}', { label })"
				:title="t('vpass', 'Copy')"
				@click="copyToClipboard(value, label)">
				<template #icon>
					<ContentCopyIcon :size="20" />
				</template>
			</NcButton>
		</div>
	</div>
</template>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import { computed, ref } from 'vue'
import ContentCopyIcon from 'vue-material-design-icons/ContentCopy.vue'
import EyeIcon from 'vue-material-design-icons/Eye.vue'
import EyeOffIcon from 'vue-material-design-icons/EyeOff.vue'
import OpenInNewIcon from 'vue-material-design-icons/OpenInNew.vue'
import { copyToClipboard } from '../services/browser.ts'

const props = withDefaults(defineProps<{
	label: string
	value?: string
	/** Shown instead of value (e.g. formatted card number); copying still uses value. */
	displayValue?: string
	secret?: boolean
	multiline?: boolean
	monospace?: boolean
	href?: string
	copyable?: boolean
}>(), { value: '', displayValue: '', href: '', copyable: true })

const revealed = ref(false)
const display = computed(() => props.displayValue || props.value)
</script>

<style scoped lang="scss">
.field-row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	border-radius: var(--border-radius-large);

	&:hover {
		background: var(--color-background-hover);
	}

	&__content {
		flex: 1;
		min-width: 0;
	}

	&__label {
		font-size: 0.85em;
		color: var(--color-text-maxcontrast);
	}

	&__value {
		overflow-wrap: anywhere;

		&--mono {
			font-family: var(--font-face-monospace, monospace);
			letter-spacing: 0.02em;
		}

		&--multiline {
			white-space: pre-wrap;
		}

		a {
			color: var(--color-primary-element);
			text-decoration: underline;
		}
	}

	&__actions {
		display: flex;
		flex-shrink: 0;
	}
}
</style>
