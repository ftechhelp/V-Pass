<template>
	<div class="password-input">
		<div class="password-input__row">
			<NcPasswordField v-model="model"
				class="password-input__field"
				:label="label"
				:autocomplete="autocomplete"
				:input-class="'password-input__mono'" />
			<NcButton v-if="generator"
				variant="secondary"
				:aria-label="t('vpass', 'Generate password')"
				:title="t('vpass', 'Generate password')"
				@click="showGenerator = true">
				<template #icon>
					<Dice5Icon :size="20" />
				</template>
			</NcButton>
		</div>
		<StrengthMeter v-if="showStrength && model" :password="model" :user-inputs="userInputs" :show-feedback="showFeedback" />

		<NcDialog v-if="showGenerator"
			v-model:open="showGenerator"
			:name="t('vpass', 'Generate password')"
			size="normal">
			<GeneratorPanel :use-label="t('vpass', 'Use this password')" @use="use" />
		</NcDialog>
	</div>
</template>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcPasswordField from '@nextcloud/vue/components/NcPasswordField'
import { ref } from 'vue'
import Dice5Icon from 'vue-material-design-icons/Dice5.vue'
import GeneratorPanel from './GeneratorPanel.vue'
import StrengthMeter from './StrengthMeter.vue'

withDefaults(defineProps<{
	label: string
	generator?: boolean
	showStrength?: boolean
	showFeedback?: boolean
	userInputs?: string[]
	autocomplete?: string
}>(), { generator: true, showStrength: true, userInputs: () => [], autocomplete: 'new-password' })

const model = defineModel<string>({ required: true })
const showGenerator = ref(false)

function use(value: string): void {
	model.value = value
	showGenerator.value = false
}
</script>

<style scoped lang="scss">
.password-input {
	&__row {
		display: flex;
		align-items: flex-end;
		gap: 8px;
	}

	&__field {
		flex: 1;
	}

	:deep(.password-input__mono) {
		font-family: var(--font-face-monospace, monospace);
	}
}
</style>
