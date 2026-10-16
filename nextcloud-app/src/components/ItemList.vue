<template>
	<div class="item-list">
		<div class="item-list__header">
			<NcTextField ref="searchField"
				v-model="query"
				class="item-list__search"
				:label="t('vpass', 'Search')"
				:placeholder="t('vpass', 'Search {where}', { where: heading.toLowerCase() })"
				trailing-button-icon="close"
				:show-trailing-button="query !== ''"
				type="search"
				@trailing-button-click="query = ''">
				<template #icon>
					<MagnifyIcon :size="20" />
				</template>
			</NcTextField>
			<NewItemMenu v-if="!trash" @create="emit('new', $event)" />
		</div>

		<div class="item-list__title">
			<span>{{ heading }}</span>
			<span class="item-list__count">{{ entries.length }}</span>
			<NcButton v-if="trash && entries.length" variant="tertiary" class="item-list__empty-trash" @click="emit('empty-trash')">
				<template #icon>
					<DeleteForeverIcon :size="20" />
				</template>
				{{ t('vpass', 'Empty trash') }}
			</NcButton>
		</div>

		<ul v-if="entries.length" class="item-list__items" :aria-label="heading">
			<NcListItem v-for="entry in entries"
				:key="entry.id"
				:name="itemDisplayTitle(entry.item)"
				:to="linkTo(entry.id)"
				:active="entry.id === selectedId"
				:data-test="`item-${entry.id}`">
				<template #icon>
					<ItemIcon :item="entry.item" />
				</template>
				<template #subname>
					{{ itemSubtitle(entry.item) }}
				</template>
				<template #details>
					<StarIcon v-if="entry.item.favorite" :size="16" class="item-list__favorite" :title="t('vpass', 'Favorite')" />
					<FingerprintIcon v-if="entry.item.type === 'login' && entry.item.passkeys.length" :size="16" :title="t('vpass', 'Has passkey')" />
				</template>
			</NcListItem>
		</ul>
		<NcEmptyContent v-else
			class="item-list__empty"
			:name="query ? t('vpass', 'No matches') : emptyText"
			:description="query ? t('vpass', 'Try a different search.') : ''">
			<template #icon>
				<MagnifyIcon v-if="query" />
				<DeleteIcon v-else-if="trash" />
				<ShieldLockIcon v-else />
			</template>
		</NcEmptyContent>
	</div>
</template>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcListItem from '@nextcloud/vue/components/NcListItem'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { type ItemType, itemDisplayTitle, itemSubtitle } from '@vpass/core'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { type RouteLocationRaw, useRoute } from 'vue-router'
import DeleteForeverIcon from 'vue-material-design-icons/DeleteForever.vue'
import DeleteIcon from 'vue-material-design-icons/DeleteOutline.vue'
import FingerprintIcon from 'vue-material-design-icons/Fingerprint.vue'
import MagnifyIcon from 'vue-material-design-icons/Magnify.vue'
import ShieldLockIcon from 'vue-material-design-icons/ShieldLock.vue'
import StarIcon from 'vue-material-design-icons/Star.vue'
import type { VaultEntry } from '../stores/vault.ts'
import ItemIcon from './ItemIcon.vue'
import NewItemMenu from './NewItemMenu.vue'

defineProps<{
	entries: VaultEntry[]
	heading: string
	selectedId?: string
	trash?: boolean
	emptyText: string
}>()

const emit = defineEmits<{ new: [type: ItemType], 'empty-trash': [] }>()
const query = defineModel<string>('query', { required: true })
const route = useRoute()
const searchField = ref<{ $el: HTMLElement }>()

function linkTo(itemId: string): RouteLocationRaw {
	return { name: route.name ?? 'category', params: { ...route.params, itemId } }
}

/** "/" focuses search, as in most web apps. */
function onKeydown(event: KeyboardEvent): void {
	const target = event.target as HTMLElement
	if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(target.tagName) && !target.isContentEditable) {
		event.preventDefault()
		searchField.value?.$el.querySelector('input')?.focus()
	}
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped lang="scss">
.item-list {
	display: flex;
	flex-direction: column;
	height: 100%;

	&__header {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		padding: 8px 8px 4px calc(var(--default-clickable-area) + 12px);
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--color-main-background);
	}

	&__search {
		flex: 1;
	}

	&__title {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 16px;
		font-weight: 600;
		min-height: var(--default-clickable-area);
	}

	&__count {
		color: var(--color-text-maxcontrast);
		font-weight: normal;
	}

	&__empty-trash {
		margin-inline-start: auto;
	}

	&__items {
		padding: 0 4px 12px;
	}

	&__favorite {
		color: var(--color-warning);
	}

	&__empty {
		margin-top: 15vh;
	}
}
</style>
