<template>
	<div class="list-editor">
		<div v-for="(field, index) in model" :key="index" class="list-editor__row">
			<div class="custom-field">
				<NcTextField v-model="field.label" :label="t('vpass', 'Label')" />
				<NcPasswordField v-if="field.type === 'hidden'" v-model="field.value" :label="t('vpass', 'Value')" autocomplete="off" />
				<NcTextField v-else v-model="field.value" :label="t('vpass', 'Value')" autocomplete="off" />
				<NcCheckboxRadioSwitch :model-value="field.type === 'hidden'" @update:model-value="field.type = $event ? 'hidden' : 'text'">
					{{ t('vpass', 'Hidden') }}
				</NcCheckboxRadioSwitch>
			</div>
			<NcButton variant="tertiary" :aria-label="t('vpass', 'Remove field')" :title="t('vpass', 'Remove field')" @click="model.splice(index, 1)">
				<template #icon>
					<CloseIcon :size="20" />
				</template>
			</NcButton>
		</div>
		<NcButton variant="tertiary" @click="model.push({ label: '', type: 'text', value: '' })">
			<template #icon>
				<PlusIcon :size="20" />
			</template>
			{{ t('vpass', 'Add custom field') }}
		</NcButton>
	</div>
</template>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcPasswordField from '@nextcloud/vue/components/NcPasswordField'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import type { CustomField } from '@vpass/core'
import CloseIcon from 'vue-material-design-icons/Close.vue'
import PlusIcon from 'vue-material-design-icons/Plus.vue'

const model = defineModel<CustomField[]>({ required: true })
</script>

<style scoped lang="scss">
@use '../styles/list-editor.scss';

.custom-field {
	display: grid;
	grid-template-columns: 1fr 2fr auto;
	gap: 8px;
	align-items: center;

	@media (max-width: 600px) {
		grid-template-columns: 1fr;
	}
}
</style>
