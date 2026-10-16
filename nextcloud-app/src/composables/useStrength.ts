import { type StrengthResult, checkStrength, isStrengthEstimatorLoaded, loadStrengthEstimator } from '@vpass/core'
import { type MaybeRefOrGetter, computed, ref, toValue } from 'vue'

const loaded = ref(isStrengthEstimatorLoaded())

export function ensureStrengthEstimator(): Promise<void> {
	return loadStrengthEstimator().then(() => {
		loaded.value = true
	})
}

/** Reactive zxcvbn result; null until the dictionaries have loaded or when empty. */
export function useStrength(password: MaybeRefOrGetter<string>, userInputs: MaybeRefOrGetter<string[]> = []) {
	ensureStrengthEstimator()
	return computed<StrengthResult | null>(() => {
		const value = toValue(password)
		if (!loaded.value || !value) {
			return null
		}
		return checkStrength(value, toValue(userInputs))
	})
}

export function strengthScore(password: string, userInputs: string[] = []): number {
	return checkStrength(password, userInputs).score
}
