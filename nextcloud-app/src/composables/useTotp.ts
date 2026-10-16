import { type TotpCode, type TotpParams, parseTotp, totpCode } from '@vpass/core'
import { type MaybeRefOrGetter, computed, onBeforeUnmount, ref, toValue, watch } from 'vue'

/** Live TOTP code for an otpauth URI / secret, refreshed every second. */
export function useTotp(source: MaybeRefOrGetter<string>) {
	const params = computed<TotpParams | null>(() => {
		const value = toValue(source)
		if (!value) return null
		try {
			return parseTotp(value)
		} catch {
			return null
		}
	})
	const current = ref<TotpCode | null>(null)
	const invalid = computed(() => Boolean(toValue(source)) && params.value === null)

	async function refresh(): Promise<void> {
		current.value = params.value ? await totpCode(params.value) : null
	}

	watch(params, refresh, { immediate: true })
	const timer = setInterval(refresh, 1000)
	onBeforeUnmount(() => clearInterval(timer))

	return { current, params, invalid }
}
