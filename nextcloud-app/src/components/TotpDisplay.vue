<template>
	<div v-if="current" class="totp">
		<div class="totp__content">
			<div class="totp__label">
				{{ t('vpass', 'Authenticator code') }}
			</div>
			<div class="totp__code" data-test="totp-code">
				{{ formatTotpCode(current.code) }}
			</div>
		</div>
		<svg class="totp__ring" viewBox="0 0 36 36" :aria-label="n('vpass', '%n second left', '%n seconds left', current.remaining)" role="img">
			<circle cx="18" cy="18" r="15" class="totp__track" />
			<circle cx="18"
				cy="18"
				r="15"
				class="totp__progress"
				:class="{ 'totp__progress--low': current.remaining <= 5 }"
				:stroke-dasharray="`${(current.remaining / current.period) * 94.25} 94.25`" />
			<text x="18" y="22" text-anchor="middle">{{ current.remaining }}</text>
		</svg>
		<NcButton variant="tertiary" :aria-label="t('vpass', 'Copy authenticator code')" :title="t('vpass', 'Copy')" @click="copyToClipboard(current.code, t('vpass', 'Code'))">
			<template #icon>
				<ContentCopyIcon :size="20" />
			</template>
		</NcButton>
	</div>
	<div v-else-if="invalid" class="totp totp--invalid">
		{{ t('vpass', 'The saved authenticator key is not valid') }}
	</div>
</template>

<script setup lang="ts">
import { n, t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import { formatTotpCode } from '@vpass/core'
import ContentCopyIcon from 'vue-material-design-icons/ContentCopy.vue'
import { useTotp } from '../composables/useTotp.ts'
import { copyToClipboard } from '../services/browser.ts'

const props = defineProps<{ uri: string }>()
const { current, invalid } = useTotp(() => props.uri)
</script>

<style scoped lang="scss">
.totp {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 8px 12px;
	border-radius: var(--border-radius-large);

	&:hover {
		background: var(--color-background-hover);
	}

	&--invalid {
		color: var(--color-error-text);
	}

	&__content {
		flex: 1;
	}

	&__label {
		font-size: 0.85em;
		color: var(--color-text-maxcontrast);
	}

	&__code {
		font-family: var(--font-face-monospace, monospace);
		font-size: 1.5em;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: var(--color-primary-element);
	}

	&__ring {
		width: 36px;
		height: 36px;
		transform: rotate(-90deg);

		text {
			transform: rotate(90deg);
			transform-origin: 18px 18px;
			font-size: 11px;
			fill: var(--color-main-text);
		}
	}

	&__track {
		fill: none;
		stroke: var(--color-border);
		stroke-width: 3;
	}

	&__progress {
		fill: none;
		stroke: var(--color-primary-element);
		stroke-width: 3;
		stroke-linecap: round;
		transition: stroke-dasharray 0.9s linear;

		&--low {
			stroke: var(--color-error);
		}
	}
}
</style>
