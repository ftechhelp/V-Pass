import { ref } from 'vue'
import { send } from '../../shared/runtime.ts'

/** Copy to the clipboard and let the background clear it later. `copied` names the last copied field briefly. */
export function useCopy() {
	const copied = ref<string | null>(null)
	let timer: ReturnType<typeof setTimeout> | undefined

	async function copy(text: string, key: string): Promise<void> {
		await navigator.clipboard.writeText(text)
		copied.value = key
		clearTimeout(timer)
		timer = setTimeout(() => {
			copied.value = null
		}, 1500)
		send('copied').catch(() => {})
	}

	return { copied, copy }
}
