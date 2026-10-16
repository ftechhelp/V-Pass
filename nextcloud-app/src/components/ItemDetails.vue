<template>
	<article class="item-details" :aria-label="title">
		<header class="item-details__header">
			<ItemIcon :item="item" size="large" />
			<div class="item-details__heading">
				<h2 class="item-details__title">
					{{ title }}
				</h2>
				<div class="item-details__subtitle">
					{{ typeLabel }}<template v-if="folderName">
						· <FolderOutlineIcon :size="14" /> {{ folderName }}
					</template>
				</div>
			</div>
			<div class="item-details__actions">
				<template v-if="!trash">
					<NcButton variant="tertiary"
						:aria-label="item.favorite ? t('vpass', 'Remove from favorites') : t('vpass', 'Add to favorites')"
						:title="item.favorite ? t('vpass', 'Remove from favorites') : t('vpass', 'Add to favorites')"
						@click="toggleFavorite">
						<template #icon>
							<StarIcon v-if="item.favorite" :size="20" class="item-details__star" />
							<StarOutlineIcon v-else :size="20" />
						</template>
					</NcButton>
					<NcButton variant="primary" data-test="edit-item" @click="emit('edit')">
						<template #icon>
							<PencilIcon :size="20" />
						</template>
						{{ t('vpass', 'Edit') }}
					</NcButton>
					<NcActions :aria-label="t('vpass', 'More actions')">
						<NcActionButton v-for="folder in moveTargets" :key="folder.id ?? 'none'" close-after-click @click="move(folder.id)">
							<template #icon>
								<FolderMoveIcon :size="20" />
							</template>
							{{ folder.id ? t('vpass', 'Move to {folder}', { folder: folder.name }) : t('vpass', 'Remove from folder') }}
						</NcActionButton>
						<NcActionButton close-after-click data-test="trash-item" @click="moveToTrash">
							<template #icon>
								<DeleteIcon :size="20" />
							</template>
							{{ t('vpass', 'Move to trash') }}
						</NcActionButton>
					</NcActions>
				</template>
				<template v-else>
					<NcButton variant="primary" @click="restore">
						<template #icon>
							<RestoreIcon :size="20" />
						</template>
						{{ t('vpass', 'Restore') }}
					</NcButton>
					<NcButton variant="error" @click="deleteForever">
						<template #icon>
							<DeleteForeverIcon :size="20" />
						</template>
						{{ t('vpass', 'Delete permanently') }}
					</NcButton>
				</template>
			</div>
		</header>

		<NcNoteCard v-if="trash" type="warning">
			{{ t('vpass', 'This item is in the trash and will be deleted permanently {days} days after it was moved there.', { days: retentionDays }) }}
		</NcNoteCard>

		<section class="item-details__fields">
			<template v-if="item.type === 'login'">
				<FieldRow :label="t('vpass', 'Username')" :value="item.username" />
				<FieldRow :label="t('vpass', 'Password')" :value="item.password" secret data-test="field-password" />
				<StrengthMeter v-if="item.password" class="item-details__strength" :password="item.password" :user-inputs="[item.username, item.title]" :show-crack-time="false" />
				<TotpDisplay v-if="item.totp" :uri="item.totp" />
				<FieldRow v-for="(url, i) in item.urls"
					:key="`url-${i}`"
					:label="i === 0 ? t('vpass', 'Website') : t('vpass', 'Website {n}', { n: i + 1 })"
					:value="url"
					:href="safeHref(url)" />
			</template>

			<template v-else-if="item.type === 'card'">
				<FieldRow :label="t('vpass', 'Cardholder name')" :value="item.cardholderName" />
				<FieldRow :label="t('vpass', 'Card number')" :value="item.number.replace(/\s/g, '')" :display-value="formatCardNumber(item.number)" secret monospace />
				<FieldRow :label="t('vpass', 'Expiry date')" :value="expiry" />
				<FieldRow :label="t('vpass', 'Security code (CVC)')" :value="item.cvc" secret />
				<FieldRow :label="t('vpass', 'PIN')" :value="item.pin" secret />
				<FieldRow :label="t('vpass', 'ZIP / postal code')" :value="item.zip" />
			</template>

			<template v-else-if="item.type === 'identity'">
				<FieldRow :label="t('vpass', 'Full name')" :value="fullName(item)" />
				<FieldRow :label="t('vpass', 'Email')" :value="item.email" :href="item.email ? `mailto:${item.email}` : ''" />
				<FieldRow :label="t('vpass', 'Phone')" :value="item.phone" :href="item.phone ? `tel:${item.phone.replace(/[^\d+]/g, '')}` : ''" />
				<FieldRow :label="t('vpass', 'Company')" :value="item.company" />
				<FieldRow :label="t('vpass', 'Address')" :value="address" multiline />
				<FieldRow :label="t('vpass', 'Birthday')" :value="item.birthday" />
			</template>

			<FieldRow :label="item.type === 'note' ? t('vpass', 'Note') : t('vpass', 'Notes')" :value="item.notes" multiline />

			<FieldRow v-for="(field, i) in item.customFields"
				:key="`cf-${i}`"
				:label="field.label || t('vpass', 'Custom field')"
				:value="field.value"
				:secret="field.type === 'hidden'" />
		</section>

		<PasskeyList v-if="item.type === 'login' && item.passkeys.length" :model-value="item.passkeys" />

		<AttachmentsPanel :item-id="entry.id" :editable="!trash" />

		<details v-if="item.type === 'login' && item.passwordHistory.length" class="item-details__history">
			<summary>{{ t('vpass', 'Password history ({n})', { n: item.passwordHistory.length }) }}</summary>
			<FieldRow v-for="(old, i) in item.passwordHistory"
				:key="`h-${i}`"
				:label="t('vpass', 'Used until {date}', { date: new Date(old.changedAt).toLocaleString() })"
				:value="old.password"
				secret />
		</details>

		<footer class="item-details__meta">
			{{ t('vpass', 'Created {created} · Last modified {modified}', {
				created: new Date(entry.createdAt * 1000).toLocaleString(),
				modified: new Date(entry.updatedAt * 1000).toLocaleString(),
			}) }}
		</footer>
	</article>
</template>

<script setup lang="ts">
import { showError, showSuccess, showUndo } from '@nextcloud/dialogs'
import { loadState } from '@nextcloud/initial-state'
import { t } from '@nextcloud/l10n'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import { formatCardNumber, fullName, itemDisplayTitle, normaliseUrl } from '@vpass/core'
import { computed } from 'vue'
import DeleteForeverIcon from 'vue-material-design-icons/DeleteForever.vue'
import DeleteIcon from 'vue-material-design-icons/DeleteOutline.vue'
import FolderMoveIcon from 'vue-material-design-icons/FolderMove.vue'
import FolderOutlineIcon from 'vue-material-design-icons/FolderOutline.vue'
import PencilIcon from 'vue-material-design-icons/Pencil.vue'
import RestoreIcon from 'vue-material-design-icons/Restore.vue'
import StarIcon from 'vue-material-design-icons/Star.vue'
import StarOutlineIcon from 'vue-material-design-icons/StarOutline.vue'
import { confirmAction } from '../services/browser.ts'
import { type VaultEntry, useVaultStore } from '../stores/vault.ts'
import { ITEM_TYPE_INFO } from '../utils/itemTypes.ts'
import AttachmentsPanel from './AttachmentsPanel.vue'
import FieldRow from './FieldRow.vue'
import ItemIcon from './ItemIcon.vue'
import PasskeyList from './PasskeyList.vue'
import StrengthMeter from './StrengthMeter.vue'
import TotpDisplay from './TotpDisplay.vue'

const props = defineProps<{ entry: VaultEntry, trash?: boolean }>()
const emit = defineEmits<{ edit: [], closed: [] }>()

const store = useVaultStore()
const retentionDays = loadState<{ trashRetentionDays: number }>('vpass', 'config', { trashRetentionDays: 30 }).trashRetentionDays

const item = computed(() => props.entry.item)
const title = computed(() => itemDisplayTitle(item.value))
const typeLabel = computed(() => ITEM_TYPE_INFO[item.value.type].label)
const folderName = computed(() => (item.value.folderId ? store.folders.get(item.value.folderId)?.name ?? '' : ''))

const moveTargets = computed(() => [
	...(item.value.folderId ? [{ id: null, name: '' }] : []),
	...store.folderList.filter((f) => f.id !== item.value.folderId),
])

const expiry = computed(() => (item.value.type === 'card' && item.value.expMonth && item.value.expYear ? `${item.value.expMonth}/${item.value.expYear}` : ''))

const address = computed(() => {
	if (item.value.type !== 'identity') return ''
	const i = item.value
	return [i.address1, i.address2, [i.zip, i.city].filter(Boolean).join(' '), [i.state, i.country].filter(Boolean).join(', ')].filter(Boolean).join('\n')
})

/** Only http(s) links are clickable; anything else (javascript:, data:) is shown as text. */
function safeHref(url: string): string {
	const normalised = normaliseUrl(url)
	return /^https?:\/\//i.test(normalised) ? normalised : ''
}

async function run(action: () => Promise<unknown>, success?: string): Promise<void> {
	try {
		await action()
		if (success) showSuccess(success)
	} catch (e) {
		showError((e as Error).message)
	}
}

function toggleFavorite(): Promise<void> {
	return run(() => store.patchItem(props.entry.id, { favorite: !item.value.favorite }))
}

function move(folderId: string | null): Promise<void> {
	return run(() => store.patchItem(props.entry.id, { folderId }), t('vpass', 'Moved'))
}

function moveToTrash(): Promise<void> {
	const id = props.entry.id
	return run(async () => {
		await store.trashItem(id)
		emit('closed')
		showUndo(t('vpass', 'Moved to trash'), () => run(() => store.restoreItem(id), t('vpass', 'Item restored')))
	})
}

function restore(): Promise<void> {
	return run(async () => {
		await store.restoreItem(props.entry.id)
		emit('closed')
	}, t('vpass', 'Item restored'))
}

async function deleteForever(): Promise<void> {
	const confirmed = await confirmAction(
		t('vpass', 'Delete permanently?'),
		t('vpass', '"{title}" and its files will be deleted permanently. This cannot be undone.', { title: title.value }),
		t('vpass', 'Delete permanently'),
	)
	if (!confirmed) return
	return run(async () => {
		await store.deleteItem(props.entry.id)
		emit('closed')
	}, t('vpass', 'Deleted permanently'))
}
</script>

<style scoped lang="scss">
.item-details {
	max-width: 760px;
	margin: 0 auto;
	padding: 20px 20px 40px;

	&__header {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 16px;
		flex-wrap: wrap;
	}

	&__heading {
		flex: 1;
		min-width: 160px;
	}

	&__title {
		margin: 0;
		font-size: 1.5em;
		overflow-wrap: anywhere;
	}

	&__subtitle {
		color: var(--color-text-maxcontrast);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	&__actions {
		display: flex;
		gap: 6px;
		align-items: center;
	}

	&__star {
		color: var(--color-warning);
	}

	&__fields {
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-container, 12px);
		padding: 4px;
	}

	&__strength {
		padding: 0 12px 8px;
	}

	&__history {
		margin-top: 16px;
		padding: 0 12px;

		summary {
			cursor: pointer;
			font-weight: 600;
		}
	}

	&__meta {
		margin-top: 24px;
		padding: 0 12px;
		color: var(--color-text-maxcontrast);
		font-size: 0.85em;
	}
}
</style>
