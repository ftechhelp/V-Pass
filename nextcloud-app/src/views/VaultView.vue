<template>
	<NcAppContent v-model:show-details="showDetails" :page-heading="heading" :list-min-width="22" :list-size="28">
		<template #list>
			<ItemList v-model:query="query"
				:entries="entries"
				:heading="heading"
				:selected-id="itemId"
				:trash="trash"
				:empty-text="emptyText"
				@new="startCreate"
				@empty-trash="emptyTrash" />
		</template>

		<ItemEditor v-if="editing"
			:key="editing.key"
			:entry="editing.entry"
			:type="editing.type"
			:folder-id="folderId ?? null"
			@saved="onSaved"
			@cancel="editing = null" />
		<ItemDetails v-else-if="selected"
			:key="selected.id"
			:entry="selected"
			:trash="trash"
			@edit="editing = { key: `edit-${selected.id}`, entry: selected }"
			@closed="closeItem" />
		<NcEmptyContent v-else-if="store.active.length === 0 && !trash"
			class="vault-view__welcome"
			:name="t('vpass', 'Your vault is empty')"
			:description="t('vpass', 'Add your first password, or bring everything over from NordPass in one go.')">
			<template #icon>
				<ShieldLockIcon />
			</template>
			<template #action>
				<div class="vault-view__actions">
					<NcButton variant="primary" @click="startCreate(defaultTypeFor(category))">
						<template #icon>
							<PlusIcon :size="20" />
						</template>
						{{ t('vpass', 'Add item') }}
					</NcButton>
					<NcButton :to="{ name: 'import' }">
						<template #icon>
							<ImportIcon :size="20" />
						</template>
						{{ t('vpass', 'Import from NordPass') }}
					</NcButton>
				</div>
			</template>
		</NcEmptyContent>
		<NcEmptyContent v-else
			:name="t('vpass', 'Select an item')"
			:description="trash ? '' : t('vpass', 'Pick an item from the list, or press N to add a new one.')">
			<template #icon>
				<ShieldLockIcon />
			</template>
		</NcEmptyContent>
	</NcAppContent>
</template>

<script setup lang="ts">
import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import type { ItemType } from '@vpass/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ImportIcon from 'vue-material-design-icons/Import.vue'
import PlusIcon from 'vue-material-design-icons/Plus.vue'
import ShieldLockIcon from 'vue-material-design-icons/ShieldLock.vue'
import ItemDetails from '../components/ItemDetails.vue'
import ItemEditor from '../components/ItemEditor.vue'
import ItemList from '../components/ItemList.vue'
import { confirmAction } from '../services/browser.ts'
import { type Category, type VaultEntry, useVaultStore } from '../stores/vault.ts'
import { categoryLabel, defaultTypeFor } from '../utils/itemTypes.ts'

const props = defineProps<{
	category?: Category
	folderId?: string
	itemId?: string
	trash?: boolean
}>()

const store = useVaultStore()
const route = useRoute()
const router = useRouter()
const query = ref('')
const editing = ref<{ key: string, entry?: VaultEntry, type?: ItemType } | null>(null)

const heading = computed(() => {
	if (props.trash) return t('vpass', 'Trash')
	if (props.folderId) return store.folders.get(props.folderId)?.name ?? t('vpass', 'Folder')
	return categoryLabel(props.category ?? 'all')
})

const emptyText = computed(() => {
	if (props.trash) return t('vpass', 'The trash is empty')
	if (props.category === 'passkey') return t('vpass', 'No passkeys yet')
	if (props.category === 'favorites') return t('vpass', 'No favorites yet')
	return t('vpass', 'Nothing here yet')
})

const entries = computed(() => store.filter({
	category: props.trash || props.folderId ? undefined : props.category ?? 'all',
	folderId: props.folderId,
	trash: props.trash,
	query: query.value,
}))

const selected = computed(() => (props.itemId ? store.entries.get(props.itemId) : undefined))

const showDetails = computed({
	get: () => Boolean(editing.value || selected.value),
	set: (value: boolean) => {
		if (!value) {
			editing.value = null
			closeItem()
		}
	},
})

watch(() => [props.category, props.folderId, props.trash], () => {
	query.value = ''
	editing.value = null
})
watch(() => props.itemId, () => {
	if (editing.value?.entry && editing.value.entry.id !== props.itemId) {
		editing.value = null
	}
})

function startCreate(type: ItemType): void {
	editing.value = { key: `new-${Date.now()}`, type }
}

function onSaved(id: string): void {
	editing.value = null
	const entry = store.entries.get(id)
	// Stay in the current view if the item belongs there, otherwise jump to "All items".
	if (entries.value.some((e) => e.id === id) || !entry) {
		router.push({ name: route.name ?? 'category', params: { ...route.params, itemId: id } })
	} else {
		router.push({ name: 'category', params: { category: 'all', itemId: id } })
	}
}

function closeItem(): void {
	const params = { ...route.params }
	delete params.itemId
	router.push({ name: route.name ?? 'category', params })
}

async function emptyTrash(): Promise<void> {
	const confirmed = await confirmAction(
		t('vpass', 'Empty trash?'),
		t('vpass', 'All {count} items in the trash will be deleted permanently.', { count: store.trashed.length }),
		t('vpass', 'Empty trash'),
	)
	if (!confirmed) return
	try {
		await store.emptyTrash()
		showSuccess(t('vpass', 'Trash emptied'))
		closeItem()
	} catch (e) {
		showError((e as Error).message)
	}
}

/** "n" starts a new item when not typing in a field. */
function onKeydown(event: KeyboardEvent): void {
	const target = event.target as HTMLElement
	if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey
		&& !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && !target.isContentEditable && !editing.value && !props.trash) {
		event.preventDefault()
		startCreate(defaultTypeFor(props.category))
	}
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped lang="scss">
.vault-view__actions {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	justify-content: center;
}
</style>
