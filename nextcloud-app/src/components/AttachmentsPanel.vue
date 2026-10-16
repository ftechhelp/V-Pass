<template>
	<section class="attachments">
		<h3 class="attachments__heading">
			{{ t('vpass', 'Files') }}
		</h3>
		<ul v-if="records.length" class="attachments__list">
			<li v-for="record in records" :key="record.id" class="attachments__item">
				<FileOutlineIcon :size="20" />
				<span class="attachments__name">{{ store.attachmentMeta(record)?.name ?? t('vpass', 'Unreadable file') }}</span>
				<span class="attachments__size">{{ formatBytes(store.attachmentMeta(record)?.size ?? record.size) }}</span>
				<NcButton variant="tertiary" :aria-label="t('vpass', 'Download')" :title="t('vpass', 'Download')" :disabled="busy === record.id" @click="download(record)">
					<template #icon>
						<NcLoadingIcon v-if="busy === record.id" :size="20" />
						<DownloadIcon v-else :size="20" />
					</template>
				</NcButton>
				<NcButton v-if="editable" variant="tertiary" :aria-label="t('vpass', 'Delete file')" :title="t('vpass', 'Delete')" @click="remove(record)">
					<template #icon>
						<DeleteIcon :size="20" />
					</template>
				</NcButton>
			</li>
		</ul>
		<p v-else class="attachments__empty">
			{{ t('vpass', 'No files attached.') }}
		</p>
		<template v-if="editable">
			<NcButton variant="secondary" :disabled="uploading" @click="fileInput?.click()">
				<template #icon>
					<NcLoadingIcon v-if="uploading" :size="20" />
					<PaperclipIcon v-else :size="20" />
				</template>
				{{ uploading ? t('vpass', 'Encrypting and uploading…') : t('vpass', 'Attach file') }}
			</NcButton>
			<input ref="fileInput" type="file" class="hidden-visually" @change="upload">
			<p class="attachments__hint">
				{{ t('vpass', 'Files are encrypted on this device before upload. Maximum size: {size}.', { size: formatBytes(config.maxAttachmentBytes) }) }}
			</p>
		</template>
	</section>
</template>

<script setup lang="ts">
import { showError, showSuccess } from '@nextcloud/dialogs'
import { loadState } from '@nextcloud/initial-state'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import type { AttachmentRecord } from '@vpass/core'
import { computed, ref } from 'vue'
import DeleteIcon from 'vue-material-design-icons/DeleteOutline.vue'
import DownloadIcon from 'vue-material-design-icons/Download.vue'
import FileOutlineIcon from 'vue-material-design-icons/FileOutline.vue'
import PaperclipIcon from 'vue-material-design-icons/Paperclip.vue'
import { confirmAction, formatBytes, saveFile } from '../services/browser.ts'
import { useVaultStore } from '../stores/vault.ts'

const props = defineProps<{ itemId: string, editable: boolean }>()

const store = useVaultStore()
const config = loadState<{ maxAttachmentBytes: number }>('vpass', 'config', { maxAttachmentBytes: 50 * 1024 * 1024 })
const records = computed(() => store.attachmentsFor(props.itemId))
const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)
const busy = ref<string | null>(null)

async function upload(event: Event): Promise<void> {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (!file) return
	// Encryption adds ~17 bytes per 64 KiB chunk plus a header.
	if (file.size + Math.ceil(file.size / 65536) * 17 + 24 > config.maxAttachmentBytes) {
		showError(t('vpass', 'This file is too large. The maximum is {size}.', { size: formatBytes(config.maxAttachmentBytes) }))
		return
	}
	uploading.value = true
	try {
		await store.uploadAttachment(props.itemId, file)
		showSuccess(t('vpass', '{name} attached', { name: file.name }))
	} catch (e) {
		showError(t('vpass', 'Upload failed: {error}', { error: (e as Error).message }))
	} finally {
		uploading.value = false
	}
}

async function download(record: AttachmentRecord): Promise<void> {
	busy.value = record.id
	try {
		const { meta, content } = await store.downloadAttachment(record)
		saveFile(content as BlobPart, meta.name, meta.mimeType)
	} catch (e) {
		showError(t('vpass', 'Download failed: {error}', { error: (e as Error).message }))
	} finally {
		busy.value = null
	}
}

async function remove(record: AttachmentRecord): Promise<void> {
	const name = store.attachmentMeta(record)?.name ?? ''
	if (!await confirmAction(t('vpass', 'Delete file?'), t('vpass', '{name} will be deleted permanently.', { name }), t('vpass', 'Delete'))) return
	try {
		await store.deleteAttachment(record.id)
	} catch (e) {
		showError((e as Error).message)
	}
}
</script>

<style scoped lang="scss">
.attachments {
	padding: 0 12px;

	&__heading {
		font-size: 1em;
		font-weight: 600;
		margin: 16px 0 6px;
	}

	&__list {
		margin-bottom: 8px;
	}

	&__item {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	&__name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	&__size, &__empty, &__hint {
		color: var(--color-text-maxcontrast);
		font-size: 0.9em;
	}

	&__hint {
		margin-top: 6px;
	}
}
</style>
