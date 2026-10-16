import { getCurrentUser } from '@nextcloud/auth'
import { confirmPassword } from '@nextcloud/password-confirmation'
import {
	type UnlockKeyRecord,
	type VaultMeta,
	createVaultKeys,
	initCrypto,
	rewrapWithPassword,
	rotateRecoveryKey,
	unlockWithPassword,
	unlockWithRecoveryKey,
	unwrapVaultKeyWithPrf,
	wipe,
	wrapVaultKeyWithPrf,
} from '@vpass/core'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../services/api.ts'
import { nextFrame } from '../services/browser.ts'
import { evaluatePrf, registerPrfCredential } from '../services/webauthn.ts'
import { usePreferencesStore } from './preferences.ts'
import { useVaultStore } from './vault.ts'

export type SessionStatus = 'loading' | 'error' | 'setup' | 'locked' | 'unlocked'

/**
 * The vault key lives only in this module-scoped variable: never in reactive
 * state, storage, or anything that survives a page reload.
 */
let vaultKey: Uint8Array | null = null

export function requireVaultKey(): Uint8Array {
	if (!vaultKey) {
		throw new Error('The vault is locked')
	}
	return vaultKey
}

export const useSessionStore = defineStore('session', () => {
	const status = ref<SessionStatus>('loading')
	const error = ref('')
	const meta = ref<VaultMeta | null>(null)
	/** True while the onboarding wizard is still showing (vault exists and is unlocked). */
	const onboarding = ref(false)
	const unlockKeys = ref<UnlockKeyRecord[]>([])

	async function init(): Promise<void> {
		try {
			await initCrypto()
			meta.value = await api.getVault()
			status.value = meta.value ? 'locked' : 'setup'
			if (meta.value) {
				unlockKeys.value = await api.listUnlockKeys().catch(() => [])
			}
		} catch (e) {
			error.value = (e as Error).message
			status.value = 'error'
		}
	}

	/** Step 1 of onboarding. Returns the recovery key to show the user once. */
	async function createVault(masterPassword: string): Promise<string> {
		await nextFrame()
		const created = createVaultKeys(masterPassword)
		meta.value = await api.createVault(created.keyset)
		vaultKey = created.vaultKey
		onboarding.value = true
		await afterUnlock()
		return created.recoveryKey
	}

	function finishOnboarding(): void {
		onboarding.value = false
	}

	async function unlock(masterPassword: string): Promise<void> {
		const current = await refreshMeta()
		await nextFrame()
		vaultKey = unlockWithPassword(masterPassword, current)
		await afterUnlock()
	}

	/** Forgot master password: recovery key + new password. */
	async function recover(recoveryKey: string, newPassword: string): Promise<void> {
		const current = await refreshMeta()
		const vk = unlockWithRecoveryKey(recoveryKey, current)
		await nextFrame()
		meta.value = await api.updateVaultKeys(rewrapWithPassword(vk, newPassword))
		vaultKey = vk
		await afterUnlock()
	}

	async function unlockWithPasskey(): Promise<void> {
		unlockKeys.value = await api.listUnlockKeys()
		const { key, prfOutput } = await evaluatePrf(unlockKeys.value)
		const record = unlockKeys.value.find((k) => k.id === key.id)!
		try {
			vaultKey = unwrapVaultKeyWithPrf(record.wrappedVaultKey, prfOutput, record.credentialId)
		} finally {
			wipe(prfOutput)
		}
		api.markUnlockKeyUsed(record.id).catch(() => {})
		await afterUnlock()
	}

	async function afterUnlock(): Promise<void> {
		await useVaultStore().load()
		status.value = 'unlocked'
		startAutoLock()
	}

	function lock(): void {
		stopAutoLock()
		wipe(vaultKey)
		vaultKey = null
		useVaultStore().clear()
		onboarding.value = false
		if (status.value === 'unlocked') {
			status.value = 'locked'
		}
	}

	async function refreshMeta(): Promise<VaultMeta> {
		meta.value = await api.getVault()
		if (!meta.value) {
			status.value = 'setup'
			throw new Error('No vault found')
		}
		return meta.value
	}

	/* ----- security settings (require the current master password) ----- */

	async function verifyPassword(password: string): Promise<void> {
		const current = await refreshMeta()
		await nextFrame()
		wipe(unlockWithPassword(password, current))
	}

	async function changeMasterPassword(currentPassword: string, newPassword: string): Promise<void> {
		await verifyPassword(currentPassword)
		await nextFrame()
		meta.value = await api.updateVaultKeys(rewrapWithPassword(requireVaultKey(), newPassword))
	}

	async function regenerateRecoveryKey(currentPassword: string): Promise<string> {
		await verifyPassword(currentPassword)
		const { recoveryKey, recoveryWrappedVaultKey } = rotateRecoveryKey(requireVaultKey())
		meta.value = await api.updateVaultKeys({ recoveryWrappedVaultKey })
		return recoveryKey
	}

	async function addPasskeyUnlock(label: string): Promise<void> {
		const user = getCurrentUser()
		const credential = await registerPrfCredential(user?.uid ?? 'user', user?.uid ?? 'user', user?.displayName ?? user?.uid ?? 'V-Pass')
		try {
			await api.createUnlockKey({
				credentialId: credential.credentialId,
				prfSalt: credential.prfSalt,
				wrappedVaultKey: wrapVaultKeyWithPrf(requireVaultKey(), credential.prfOutput, credential.credentialId),
				label,
			})
		} finally {
			wipe(credential.prfOutput)
		}
		unlockKeys.value = await api.listUnlockKeys()
	}

	async function removePasskeyUnlock(id: number): Promise<void> {
		await api.deleteUnlockKey(id)
		unlockKeys.value = unlockKeys.value.filter((k) => k.id !== id)
	}

	async function deleteVault(): Promise<void> {
		await confirmPassword()
		await api.deleteVault()
		lock()
		meta.value = null
		unlockKeys.value = []
		status.value = 'setup'
	}

	/* ----- auto-lock ----- */

	let timer: ReturnType<typeof setTimeout> | undefined
	const activityEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

	function resetTimer(): void {
		clearTimeout(timer)
		const minutes = usePreferencesStore().autoLockMinutes
		if (minutes > 0) {
			timer = setTimeout(lock, minutes * 60_000)
		}
	}

	function onVisibilityChange(): void {
		if (document.visibilityState === 'hidden' && usePreferencesStore().lockOnHide) {
			lock()
		}
	}

	function startAutoLock(): void {
		activityEvents.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }))
		document.addEventListener('visibilitychange', onVisibilityChange)
		resetTimer()
	}

	function stopAutoLock(): void {
		clearTimeout(timer)
		activityEvents.forEach((e) => window.removeEventListener(e, resetTimer))
		document.removeEventListener('visibilitychange', onVisibilityChange)
	}

	return {
		status,
		error,
		meta,
		onboarding,
		unlockKeys,
		init,
		createVault,
		finishOnboarding,
		unlock,
		recover,
		unlockWithPasskey,
		lock,
		verifyPassword,
		changeMasterPassword,
		regenerateRecoveryKey,
		addPasskeyUnlock,
		removePasskeyUnlock,
		deleteVault,
		resetAutoLockTimer: resetTimer,
	}
})
