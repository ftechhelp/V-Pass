<template>
	<NcAppContent :page-heading="t('vpass', 'Import & export')">
		<div class="page">
			<h2 class="page__title">
				{{ t('vpass', 'Import') }}
			</h2>

			<!-- 1. choose file -->
			<template v-if="stage === 'choose'">
				<p class="page__intro">
					{{ t('vpass', 'Import a NordPass CSV export or a V-Pass backup (.vpass). The file is read and encrypted on this device; it is never uploaded unencrypted.') }}
				</p>
				<details class="import__howto">
					<summary>{{ t('vpass', 'How do I export from NordPass?') }}</summary>
					<ol>
						<li>{{ t('vpass', 'Open the NordPass desktop app or web vault and go to Settings.') }}</li>
						<li>{{ t('vpass', 'Choose "Export items", select CSV and confirm with your NordPass master password.') }}</li>
						<li>{{ t('vpass', 'Select the saved .csv file below. Delete the CSV afterwards — it is not encrypted.') }}</li>
					</ol>
				</details>
				<div class="import__drop"
					:class="{ 'import__drop--over': dragOver }"
					@dragover.prevent="dragOver = true"
					@dragleave="dragOver = false"
					@drop.prevent="onDrop">
					<UploadIcon :size="40" />
					<p>{{ t('vpass', 'Drop your NordPass .csv or V-Pass .vpass file here') }}</p>
					<NcButton variant="primary" data-test="choose-import-file" @click="fileInput?.click()">
						{{ t('vpass', 'Choose file') }}
					</NcButton>
					<input ref="fileInput"
						type="file"
						accept=".csv,.vpass,.json,text/csv,application/json"
						class="hidden-visually"
						data-test="import-file"
						@change="onFile">
				</div>
			</template>

			<!-- 1b. backup password -->
			<form v-else-if="stage === 'backup-password'" class="import__form" @submit.prevent="openBackupFile">
				<p>{{ t('vpass', 'Enter the password that was chosen when this backup was created.') }}</p>
				<NcPasswordField v-model="backupPassword" :label="t('vpass', 'Backup password')" autocomplete="off" />
				<div class="import__buttons">
					<NcButton @click="reset">
						{{ t('vpass', 'Cancel') }}
					</NcButton>
					<NcButton variant="primary" type="submit" :disabled="!backupPassword || busy">
						<template #icon>
							<NcLoadingIcon v-if="busy" :size="20" />
						</template>
						{{ t('vpass', 'Open backup') }}
					</NcButton>
				</div>
			</form>

			<!-- 2. preview -->
			<div v-else-if="stage === 'preview' && preview" class="import__preview" data-test="import-preview">
				<h3>{{ t('vpass', 'Ready to import from {source}', { source: preview.source }) }}</h3>
				<ul class="import__counts">
					<li v-for="info in typeInfos" :key="info.type">
						<component :is="info.icon" :size="20" />
						<strong>{{ preview.counts[info.type] }}</strong> {{ info.plural }}
					</li>
					<li v-if="preview.folders.length">
						<FolderIcon :size="20" />
						<strong>{{ preview.folders.length }}</strong> {{ t('vpass', 'folders') }}
						<span class="import__muted">({{ preview.folders.join(', ') }})</span>
					</li>
				</ul>
				<NcNoteCard v-if="preview.unknownColumns.length" type="info">
					{{ t('vpass', 'Extra columns were kept as custom fields: {columns}', { columns: preview.unknownColumns.join(', ') }) }}
				</NcNoteCard>
				<NcNoteCard v-if="preview.skipped.length" type="warning">
					<p>{{ n('vpass', '%n row will be skipped:', '%n rows will be skipped:', preview.skipped.length) }}</p>
					<ul class="import__skipped">
						<li v-for="row in preview.skipped.slice(0, 20)" :key="row.row">
							{{ t('vpass', 'Row {row}', { row: row.row }) }}<template v-if="row.name">
								({{ row.name }})
							</template>: {{ row.reason }}
						</li>
					</ul>
				</NcNoteCard>
				<NcCheckboxRadioSwitch v-if="duplicates.size" v-model="skipDuplicates">
					{{ n('vpass', 'Skip %n item that is already in your vault', 'Skip %n items that are already in your vault', duplicates.size) }}
				</NcCheckboxRadioSwitch>
				<div class="import__buttons">
					<NcButton @click="reset">
						{{ t('vpass', 'Cancel') }}
					</NcButton>
					<NcButton variant="primary" :disabled="toImport.length === 0" data-test="confirm-import" @click="runImport">
						<template #icon>
							<ImportIcon :size="20" />
						</template>
						{{ n('vpass', 'Import %n item', 'Import %n items', toImport.length) }}
					</NcButton>
				</div>
			</div>

			<!-- 3. progress -->
			<div v-else-if="stage === 'importing'" class="import__progress">
				<p>{{ t('vpass', 'Encrypting and saving… {done} of {total}', progress) }}</p>
				<NcProgressBar :value="progress.total ? Math.round(100 * progress.done / progress.total) : 0" size="medium" />
			</div>

			<!-- 4. done -->
			<div v-else-if="stage === 'done'" class="import__done" data-test="import-done">
				<NcNoteCard type="success">
					{{ n('vpass', '%n item was imported and encrypted.', '%n items were imported and encrypted.', imported) }}
				</NcNoteCard>
				<NcNoteCard v-if="fromCsv" type="warning">
					{{ t('vpass', 'Please delete the CSV file from your computer now (and empty the recycle bin) — it contains your passwords in plain text.') }}
				</NcNoteCard>
				<div class="import__buttons">
					<NcButton @click="reset">
						{{ t('vpass', 'Import another file') }}
					</NcButton>
					<NcButton variant="primary" :to="{ name: 'category', params: { category: 'all' } }">
						{{ t('vpass', 'Go to my vault') }}
					</NcButton>
				</div>
			</div>

			<h2 class="page__title page__title--spaced">
				{{ t('vpass', 'Export') }}
			</h2>
			<p class="page__intro">
				{{ t('vpass', 'For your security, confirm your master password before exporting.') }}
			</p>
			<NcPasswordField v-model="masterPassword" :label="t('vpass', 'Master password')" autocomplete="off" />

			<div class="export__option">
				<h3>{{ t('vpass', 'Encrypted backup (.vpass)') }}</h3>
				<p class="import__muted">
					{{ t('vpass', 'A file protected by a password you choose now. Use it to restore your vault or move it to another V-Pass. Attached files are not included.') }}
				</p>
				<PasswordInput v-model="exportPassword" :label="t('vpass', 'Backup password')" :generator="true" autocomplete="off" />
				<NcButton :disabled="!masterPassword || exportPassword.length < 8 || busy" @click="exportBackup">
					<template #icon>
						<ShieldLockIcon :size="20" />
					</template>
					{{ t('vpass', 'Download encrypted backup') }}
				</NcButton>
			</div>

			<div class="export__option">
				<h3>{{ t('vpass', 'CSV (NordPass format)') }}</h3>
				<NcNoteCard type="warning">
					{{ t('vpass', 'The CSV file is NOT encrypted. Anyone who gets the file can read all your passwords. Passkeys and attachments cannot be exported to CSV.') }}
				</NcNoteCard>
				<NcButton :disabled="!masterPassword || busy" @click="exportCsv">
					<template #icon>
						<ExportIcon :size="20" />
					</template>
					{{ t('vpass', 'Download unencrypted CSV') }}
				</NcButton>
			</div>
		</div>
	</NcAppContent>
</template>

<script setup lang="ts">
import { showError, showSuccess } from '@nextcloud/dialogs'
import { n, t } from '@nextcloud/l10n'
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcPasswordField from '@nextcloud/vue/components/NcPasswordField'
import NcProgressBar from '@nextcloud/vue/components/NcProgressBar'
import {
	type ImportedEntry,
	type ItemType,
	type SkippedRow,
	WrongPasswordError,
	findDuplicates,
	isBackupFile,
	looksLikeNordPassCsv,
	openBackup,
	parseNordPassCsv,
} from '@vpass/core'
import { computed, ref } from 'vue'
import ExportIcon from 'vue-material-design-icons/Export.vue'
import FolderIcon from 'vue-material-design-icons/FolderOutline.vue'
import ImportIcon from 'vue-material-design-icons/Import.vue'
import ShieldLockIcon from 'vue-material-design-icons/ShieldLock.vue'
import UploadIcon from 'vue-material-design-icons/Upload.vue'
import PasswordInput from '../components/PasswordInput.vue'
import { confirmAction, nextFrame, saveFile } from '../services/browser.ts'
import { useSessionStore } from '../stores/session.ts'
import { useVaultStore } from '../stores/vault.ts'
import { ITEM_TYPE_INFO } from '../utils/itemTypes.ts'

interface Preview {
	source: string
	entries: Pick<ImportedEntry, 'item' | 'folderName'>[]
	folders: string[]
	counts: Record<ItemType, number>
	skipped: SkippedRow[]
	unknownColumns: string[]
}

const store = useVaultStore()
const session = useSessionStore()
const typeInfos = Object.values(ITEM_TYPE_INFO)

const stage = ref<'choose' | 'backup-password' | 'preview' | 'importing' | 'done'>('choose')
const fileInput = ref<HTMLInputElement>()
const dragOver = ref(false)
const busy = ref(false)
const fileText = ref('')
const fromCsv = ref(false)
const backupPassword = ref('')
const preview = ref<Preview | null>(null)
const skipDuplicates = ref(true)
const progress = ref({ done: 0, total: 0 })
const imported = ref(0)

const masterPassword = ref('')
const exportPassword = ref('')

const duplicates = computed(() => (preview.value
	? findDuplicates(preview.value.entries.map((e) => e.item), store.active.map((e) => e.item))
	: new Set<number>()))

const toImport = computed(() => (preview.value?.entries ?? []).filter((_, i) => !(skipDuplicates.value && duplicates.value.has(i))))

function reset(): void {
	stage.value = 'choose'
	fileText.value = ''
	backupPassword.value = ''
	preview.value = null
	skipDuplicates.value = true
}

function onDrop(event: DragEvent): void {
	dragOver.value = false
	const file = event.dataTransfer?.files[0]
	if (file) loadFile(file)
}

function onFile(event: Event): void {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (file) loadFile(file)
}

async function loadFile(file: File): Promise<void> {
	try {
		const text = await file.text()
		if (isBackupFile(text)) {
			fileText.value = text
			fromCsv.value = false
			stage.value = 'backup-password'
			return
		}
		if (!looksLikeNordPassCsv(text)) {
			showError(t('vpass', 'This file is not a NordPass CSV export or a V-Pass backup.'))
			return
		}
		const report = parseNordPassCsv(text)
		fromCsv.value = true
		preview.value = { source: 'NordPass', ...report }
		stage.value = 'preview'
	} catch (e) {
		showError(t('vpass', 'Could not read the file: {error}', { error: (e as Error).message }))
	}
}

async function openBackupFile(): Promise<void> {
	busy.value = true
	await nextFrame()
	try {
		const payload = openBackup(fileText.value, backupPassword.value)
		const folderName = new Map(payload.folders.map((f) => [f.id, f.name]))
		const counts: Record<ItemType, number> = { login: 0, note: 0, card: 0, identity: 0 }
		payload.items.forEach(({ item }) => counts[item.type]++)
		preview.value = {
			source: t('vpass', 'V-Pass backup'),
			entries: payload.items.map(({ item }) => ({ item, folderName: item.folderId ? folderName.get(item.folderId) ?? null : null })),
			folders: payload.folders.map((f) => f.name),
			counts,
			skipped: [],
			unknownColumns: [],
		}
		stage.value = 'preview'
	} catch (e) {
		showError((e as Error).message)
	} finally {
		busy.value = false
	}
}

async function runImport(): Promise<void> {
	if (!preview.value) return
	const entries = toImport.value
	const folders = [...new Set(entries.map((e) => e.folderName).filter((f): f is string => !!f).concat(preview.value.folders))]
	stage.value = 'importing'
	progress.value = { done: 0, total: entries.length }
	try {
		imported.value = await store.importEntries(entries, folders, (done, total) => {
			progress.value = { done, total }
		})
		stage.value = 'done'
	} catch (e) {
		showError(t('vpass', 'Import stopped: {error}. Items imported so far were kept.', { error: (e as Error).message }))
		stage.value = 'preview'
	}
}

async function verifyMaster(): Promise<boolean> {
	busy.value = true
	try {
		await session.verifyPassword(masterPassword.value)
		return true
	} catch (e) {
		showError(e instanceof WrongPasswordError ? t('vpass', 'That master password is not correct') : (e as Error).message)
		return false
	} finally {
		busy.value = false
	}
}

function dateStamp(): string {
	return new Date().toISOString().slice(0, 10)
}

async function exportBackup(): Promise<void> {
	if (!await verifyMaster()) return
	busy.value = true
	await nextFrame()
	try {
		saveFile(store.exportBackup(exportPassword.value), `V-Pass backup ${dateStamp()}.vpass`, 'application/json')
		showSuccess(t('vpass', 'Encrypted backup downloaded'))
		exportPassword.value = ''
	} catch (e) {
		showError((e as Error).message)
	} finally {
		busy.value = false
	}
}

async function exportCsv(): Promise<void> {
	const confirmed = await confirmAction(
		t('vpass', 'Export unencrypted CSV?'),
		t('vpass', 'The file will contain all your passwords in plain text. Store it carefully and delete it when you are done.'),
		t('vpass', 'Export CSV'),
	)
	if (!confirmed || !await verifyMaster()) return
	saveFile(store.exportCsv(), `V-Pass export ${dateStamp()}.csv`, 'text/csv')
}
</script>

<style scoped lang="scss">
.import {
	&__howto {
		margin-bottom: 14px;

		summary {
			cursor: pointer;
			color: var(--color-primary-element);
		}

		ol {
			margin: 8px 0 0 20px;
			list-style: decimal;
		}
	}

	&__drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 32px 16px;
		border: 2px dashed var(--color-border-maxcontrast);
		border-radius: var(--border-radius-container, 14px);
		color: var(--color-text-maxcontrast);

		&--over {
			border-color: var(--color-primary-element);
			background: var(--color-primary-element-light);
		}
	}

	&__form, &__preview, &__progress, &__done {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	&__counts li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
	}

	&__skipped {
		margin: 4px 0 0 16px;
		list-style: disc;
	}

	&__muted {
		color: var(--color-text-maxcontrast);
	}

	&__buttons {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}
}

.export__option {
	display: flex;
	flex-direction: column;
	gap: 10px;
	align-items: flex-start;
	margin-top: 18px;
	padding: 16px;
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large);

	h3 {
		margin: 0;
		font-size: 1.1em;
	}

	> :deep(.password-input) {
		align-self: stretch;
	}
}
</style>
