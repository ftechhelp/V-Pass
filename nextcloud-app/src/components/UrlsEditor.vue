<template>
	<div class="list-editor">
		<div v-for="(url, index) in model" :key="index" class="list-editor__row">
			<NcTextField :model-value="url"
				:label="t('vpass', 'Website address')"
				:placeholder="PLACEHOLDER"
				type="url"
				data-test="field-url"
				@update:model-value="model[index] = String($event)" />
			<NcButton variant="tertiary" :aria-label="t('vpass', 'Remove website')" :title="t('vpass', 'Remove website')" @click="model.splice(index, 1)">
				<template #icon>
					<CloseIcon :size="20" />
				</template>
			</NcButton>
		</div>
		<NcButton variant="tertiary" @click="model.push('')">
			<template #icon>
				<PlusIcon :size="20" />
			</template>
			{{ t('vpass', 'Add website') }}
		</NcButton>
	</div>
</template>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import CloseIcon from 'vue-material-design-icons/Close.vue'
import PlusIcon from 'vue-material-design-icons/Plus.vue'

// Bound as an expression: a literal "//" in a static attribute trips up vue-tsc inside v-for.
const PLACEHOLDER = 'https://example.com'

const model = defineModel<string[]>({ required: true })
</script>

<style scoped lang="scss">
@use '../styles/list-editor.scss';
</style>
