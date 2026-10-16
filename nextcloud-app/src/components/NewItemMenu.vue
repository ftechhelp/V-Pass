<template>
	<NcActions :menu-name="t('vpass', 'New')" variant="primary" :aria-label="t('vpass', 'New item')" data-test="new-item">
		<template #icon>
			<PlusIcon :size="20" />
		</template>
		<NcActionButton v-for="info in types" :key="info.type" close-after-click @click="emit('create', info.type)">
			<template #icon>
				<component :is="info.icon" :size="20" />
			</template>
			{{ info.label }}
		</NcActionButton>
	</NcActions>
</template>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import type { ItemType } from '@vpass/core'
import PlusIcon from 'vue-material-design-icons/Plus.vue'
import { ITEM_TYPE_INFO } from '../utils/itemTypes.ts'

const emit = defineEmits<{ create: [type: ItemType] }>()
const types = Object.values(ITEM_TYPE_INFO)
</script>
