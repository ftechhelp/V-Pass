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
		<TotpRing :remaining="current.remaining" :period="current.period" />
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
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import { formatTotpCode } from '@vpass/core'
import ContentCopyIcon from 'vue-material-design-icons/ContentCopy.vue'
import { useTotp } from '../composables/useTotp.ts'
import { copyToClipboard } from '../services/browser.ts'
import TotpRing from './TotpRing.vue'

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
}
</style>
