<template>
	<div class="strength" :class="`strength--${result?.score ?? 'none'}`" aria-live="polite">
		<div class="strength__bar" role="meter" :aria-valuenow="(result?.score ?? 0) + 1" aria-valuemin="0" aria-valuemax="5" :aria-label="t('vpass', 'Password strength')">
			<span v-for="i in 5" :key="i" class="strength__segment" :class="{ 'strength__segment--on': result && i <= result.score + 1 }" />
		</div>
		<div v-if="result" class="strength__text">
			<strong>{{ labels[result.score] }}</strong>
			<span v-if="showCrackTime"> · {{ t('vpass', 'Time to crack: {time}', { time: result.crackTime }) }}</span>
			<div v-if="showFeedback && (result.warning || result.suggestions.length)" class="strength__feedback">
				{{ [result.warning, ...result.suggestions].filter(Boolean).join(' ') }}
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import { useStrength } from '../composables/useStrength.ts'

const props = withDefaults(defineProps<{
	password: string
	userInputs?: string[]
	showCrackTime?: boolean
	showFeedback?: boolean
}>(), { userInputs: () => [], showCrackTime: true, showFeedback: false })

const result = useStrength(() => props.password, () => props.userInputs)

const labels = [t('vpass', 'Very weak'), t('vpass', 'Weak'), t('vpass', 'Fair'), t('vpass', 'Strong'), t('vpass', 'Very strong')]
</script>

<style scoped lang="scss">
.strength {
	--seg: var(--color-border-dark);
	margin-top: 6px;

	&--0, &--1 { --seg: var(--color-error); }
	&--2 { --seg: var(--color-warning); }
	&--3, &--4 { --seg: var(--color-success); }

	&__bar {
		display: flex;
		gap: 4px;
	}

	&__segment {
		flex: 1;
		height: 4px;
		border-radius: 2px;
		background: var(--color-border);

		&--on {
			background: var(--seg);
		}
	}

	&__text {
		margin-top: 4px;
		font-size: 0.9em;
		color: var(--color-text-maxcontrast);
	}

	&__feedback {
		margin-top: 2px;
	}
}
</style>
