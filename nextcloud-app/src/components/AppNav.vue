<template>
	<NcAppNavigation :aria-label="t('vpass', 'Vault navigation')">
		<template #list>
			<NcAppNavigationItem v-for="category in CATEGORIES"
				:key="category.id"
				:name="category.label"
				:to="{ name: 'category', params: { category: category.id } }"
				:active="route.name === 'category' && route.params.category === category.id"
				:data-test="`nav-${category.id}`">
				<template #icon>
					<component :is="category.icon" :size="20" />
				</template>
				<template #counter>
					<NcCounterBubble v-if="store.counts[category.id]" :count="store.counts[category.id]" />
				</template>
			</NcAppNavigationItem>

			<NcAppNavigationCaption :name="t('vpass', 'Folders')" />
			<NcAppNavigationItem v-for="folder in store.folderList"
				:key="folder.id"
				:name="folder.name"
				:to="{ name: 'folder', params: { folderId: folder.id } }"
				:active="route.name === 'folder' && route.params.folderId === folder.id"
				editable
				:edit-label="t('vpass', 'Rename folder')"
				@update:name="rename(folder.id, $event)">
				<template #icon>
					<FolderIcon :size="20" />
				</template>
				<template #counter>
					<NcCounterBubble v-if="store.folderCounts.get(folder.id)" :count="store.folderCounts.get(folder.id)!" />
				</template>
				<template #actions>
					<NcActionButton close-after-click @click="removeFolder(folder.id, folder.name)">
						<template #icon>
							<DeleteIcon :size="20" />
						</template>
						{{ t('vpass', 'Delete folder') }}
					</NcActionButton>
				</template>
			</NcAppNavigationItem>
			<NcAppNavigationNewItem :name="t('vpass', 'New folder')"
				:edit-placeholder="t('vpass', 'Folder name')"
				data-test="new-folder"
				@new-item="addFolder">
				<template #icon>
					<FolderPlusIcon :size="20" />
				</template>
			</NcAppNavigationNewItem>

			<NcAppNavigationCaption :name="t('vpass', 'Tools')" />
			<NcAppNavigationItem :name="t('vpass', 'Password generator')" :to="{ name: 'generator' }">
				<template #icon>
					<Dice5Icon :size="20" />
				</template>
			</NcAppNavigationItem>
			<NcAppNavigationItem :name="t('vpass', 'Password health')" :to="{ name: 'health' }">
				<template #icon>
					<ShieldCheckIcon :size="20" />
				</template>
			</NcAppNavigationItem>
			<NcAppNavigationItem :name="t('vpass', 'Import & export')" :to="{ name: 'import' }" data-test="nav-import">
				<template #icon>
					<ImportIcon :size="20" />
				</template>
			</NcAppNavigationItem>
			<NcAppNavigationItem :name="t('vpass', 'Trash')"
				:to="{ name: 'trash' }"
				:active="route.name === 'trash'">
				<template #icon>
					<DeleteIcon :size="20" />
				</template>
				<template #counter>
					<NcCounterBubble v-if="store.trashed.length" :count="store.trashed.length" />
				</template>
			</NcAppNavigationItem>
		</template>

		<template #footer>
			<ul class="app-nav__footer">
				<NcAppNavigationItem :name="t('vpass', 'Settings')" :to="{ name: 'settings' }">
					<template #icon>
						<CogIcon :size="20" />
					</template>
				</NcAppNavigationItem>
				<NcAppNavigationItem :name="t('vpass', 'Lock vault')" data-test="lock" @click="session.lock()">
					<template #icon>
						<LockIcon :size="20" />
					</template>
				</NcAppNavigationItem>
			</ul>
		</template>
	</NcAppNavigation>
</template>

<script setup lang="ts">
import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcAppNavigation from '@nextcloud/vue/components/NcAppNavigation'
import NcAppNavigationCaption from '@nextcloud/vue/components/NcAppNavigationCaption'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcAppNavigationNewItem from '@nextcloud/vue/components/NcAppNavigationNewItem'
import NcCounterBubble from '@nextcloud/vue/components/NcCounterBubble'
import { useRoute, useRouter } from 'vue-router'
import CogIcon from 'vue-material-design-icons/Cog.vue'
import DeleteIcon from 'vue-material-design-icons/DeleteOutline.vue'
import Dice5Icon from 'vue-material-design-icons/Dice5.vue'
import FolderIcon from 'vue-material-design-icons/FolderOutline.vue'
import FolderPlusIcon from 'vue-material-design-icons/FolderPlus.vue'
import ImportIcon from 'vue-material-design-icons/Import.vue'
import LockIcon from 'vue-material-design-icons/Lock.vue'
import ShieldCheckIcon from 'vue-material-design-icons/ShieldCheck.vue'
import { confirmAction } from '../services/browser.ts'
import { useSessionStore } from '../stores/session.ts'
import { useVaultStore } from '../stores/vault.ts'
import { CATEGORIES } from '../utils/itemTypes.ts'

const store = useVaultStore()
const session = useSessionStore()
const route = useRoute()
const router = useRouter()

async function addFolder(name: string): Promise<void> {
	if (!name.trim()) return
	try {
		const folder = await store.createFolder(name)
		router.push({ name: 'folder', params: { folderId: folder.id } })
	} catch (e) {
		showError((e as Error).message)
	}
}

async function rename(id: string, name: string): Promise<void> {
	if (!name.trim()) return
	try {
		await store.renameFolder(id, name)
	} catch (e) {
		showError((e as Error).message)
	}
}

async function removeFolder(id: string, name: string): Promise<void> {
	const count = store.folderCounts.get(id) ?? 0
	const confirmed = await confirmAction(
		t('vpass', 'Delete folder "{name}"?', { name }),
		count
			? t('vpass', 'The {count} items in this folder are kept and moved out of it.', { count })
			: t('vpass', 'The folder is empty.'),
		t('vpass', 'Delete folder'),
	)
	if (!confirmed) return
	try {
		await store.deleteFolder(id)
		showSuccess(t('vpass', 'Folder deleted'))
		if (route.params.folderId === id) {
			router.push({ name: 'category', params: { category: 'all' } })
		}
	} catch (e) {
		showError((e as Error).message)
	}
}
</script>

<style scoped>
.app-nav__footer {
	padding: var(--app-navigation-padding, 8px);
}
</style>
