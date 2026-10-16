import type { ZxcvbnFactory } from '@zxcvbn-ts/core'

export type StrengthScore = 0 | 1 | 2 | 3 | 4

export interface StrengthResult {
	score: StrengthScore
	label: 'Very weak' | 'Weak' | 'Fair' | 'Strong' | 'Very strong'
	/** e.g. "3 centuries" — time to crack offline against a slow hash. */
	crackTime: string
	warning: string | null
	suggestions: string[]
}

const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const

let estimator: ZxcvbnFactory | null = null
let loading: Promise<void> | null = null

/**
 * Load the zxcvbn dictionaries (~1 MB). Dynamic imports let bundlers split
 * this out of the main chunk; call it before the first checkStrength().
 */
export function loadStrengthEstimator(): Promise<void> {
	loading ??= (async () => {
		const [{ ZxcvbnFactory }, common, en] = await Promise.all([
			import('@zxcvbn-ts/core'),
			import('@zxcvbn-ts/language-common'),
			import('@zxcvbn-ts/language-en'),
		])
		estimator = new ZxcvbnFactory({
			dictionary: { ...common.dictionary, ...en.dictionary },
			graphs: common.adjacencyGraphs,
			translations: en.translations,
		})
	})()
	return loading
}

export function isStrengthEstimatorLoaded(): boolean {
	return estimator !== null
}

export function checkStrength(password: string, userInputs: string[] = []): StrengthResult {
	if (!estimator) {
		throw new Error('Strength estimator not loaded: await loadStrengthEstimator() first')
	}
	const result = estimator.check(password, userInputs.filter(Boolean))
	return {
		score: result.score,
		label: LABELS[result.score],
		crackTime: result.crackTimes.offlineSlowHashingXPerSecond.display,
		warning: result.feedback.warning,
		suggestions: result.feedback.suggestions,
	}
}
