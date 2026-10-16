import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

/** Per-browser conveniences. Nothing sensitive is stored here. */
const STORAGE_KEY = 'vpass:preferences'

interface Preferences {
	autoLockMinutes: number
	clipboardClearSeconds: number
	lockOnHide: boolean
}

const DEFAULTS: Preferences = {
	autoLockMinutes: 15,
	clipboardClearSeconds: 30,
	lockOnHide: false,
}

function load(): Preferences {
	try {
		return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
	} catch {
		return { ...DEFAULTS }
	}
}

export const usePreferencesStore = defineStore('preferences', () => {
	const initial = load()
	const autoLockMinutes = ref(initial.autoLockMinutes)
	const clipboardClearSeconds = ref(initial.clipboardClearSeconds)
	const lockOnHide = ref(initial.lockOnHide)

	watch([autoLockMinutes, clipboardClearSeconds, lockOnHide], () => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({
				autoLockMinutes: autoLockMinutes.value,
				clipboardClearSeconds: clipboardClearSeconds.value,
				lockOnHide: lockOnHide.value,
			}))
		} catch {
			// storage unavailable (private mode); preferences stay for this session
		}
	})

	return { autoLockMinutes, clipboardClearSeconds, lockOnHide }
})
