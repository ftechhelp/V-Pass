<template>
	<div class="recovery-key">
		<code class="recovery-key__value" data-test="recovery-key">{{ recoveryKey }}</code>
		<div class="recovery-key__actions">
			<NcButton variant="secondary" @click="download">
				<template #icon>
					<DownloadIcon :size="20" />
				</template>
				{{ t('vpass', 'Download recovery kit') }}
			</NcButton>
			<NcButton variant="tertiary" @click="copyToClipboard(recoveryKey, t('vpass', 'Recovery key'))">
				<template #icon>
					<ContentCopyIcon :size="20" />
				</template>
				{{ t('vpass', 'Copy') }}
			</NcButton>
		</div>
	</div>
</template>

<script setup lang="ts">
import { getCurrentUser } from '@nextcloud/auth'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import ContentCopyIcon from 'vue-material-design-icons/ContentCopy.vue'
import DownloadIcon from 'vue-material-design-icons/Download.vue'
import { copyToClipboard, saveFile } from '../services/browser.ts'

const props = defineProps<{ recoveryKey: string }>()

function download(): void {
	const user = getCurrentUser()
	const text = [
		'V-Pass Recovery Kit',
		'===================',
		'',
		`Nextcloud:  ${window.location.origin}`,
		`Account:    ${user?.uid ?? ''}`,
		`Created:    ${new Date().toLocaleString()}`,
		'',
		'Recovery key:',
		'',
		`    ${props.recoveryKey}`,
		'',
		'If you forget your master password, open V-Pass, choose',
		'"Forgot master password?" and enter this key to set a new one.',
		'',
		'Keep this file somewhere safe and offline. Anyone who has this key',
		'AND access to your Nextcloud account can open your vault.',
		'',
	].join('\n')
	saveFile(text, 'V-Pass Recovery Kit.txt', 'text/plain')
}
</script>

<style scoped lang="scss">
.recovery-key {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 14px;
	border: 2px dashed var(--color-border-maxcontrast);
	border-radius: var(--border-radius-large);

	&__value {
		font-family: var(--font-face-monospace, monospace);
		font-size: 1.1em;
		line-height: 1.6;
		word-spacing: 0.3em;
		overflow-wrap: anywhere;
		text-align: center;
		user-select: all;
	}

	&__actions {
		display: flex;
		gap: 8px;
		justify-content: center;
		flex-wrap: wrap;
	}
}
</style>
