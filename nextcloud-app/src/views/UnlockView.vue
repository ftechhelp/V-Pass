<template>
	<div class="gate">
		<div class="gate__card" data-test="unlock">
			<div class="gate__logo">
				<ShieldLockIcon :size="48" />
				<span>V-Pass</span>
			</div>

			<form v-if="mode === 'password'" class="gate__form" @submit.prevent="unlock">
				<h2>{{ t('vpass', 'Unlock your vault') }}</h2>
				<NcPasswordField ref="passwordField"
					v-model="password"
					:label="t('vpass', 'Master password')"
					autocomplete="off"
					:error="!!error"
					:helper-text="error"
					data-test="unlock-password" />
				<NcButton variant="primary" type="submit" wide :disabled="!password || busy" data-test="unlock-submit">
					<template #icon>
						<NcLoadingIcon v-if="busy" :size="20" />
						<LockOpenIcon v-else :size="20" />
					</template>
					{{ busy ? t('vpass', 'Unlocking…') : t('vpass', 'Unlock') }}
				</NcButton>
				<NcButton v-if="canUsePasskey" wide :disabled="busy" @click="unlockWithPasskey">
					<template #icon>
						<FingerprintIcon :size="20" />
					</template>
					{{ t('vpass', 'Unlock with passkey') }}
				</NcButton>
				<div class="gate__links">
					<NcButton variant="tertiary" @click="mode = 'recover'">
						{{ t('vpass', 'Forgot master password?') }}
					</NcButton>
				</div>
			</form>

			<form v-else class="gate__form" @submit.prevent="recover">
				<h2>{{ t('vpass', 'Reset master password') }}</h2>
				<p>{{ t('vpass', 'Enter the recovery key from your V-Pass Recovery Kit, then choose a new master password.') }}</p>
				<NcTextArea v-model="recoveryKey"
					:label="t('vpass', 'Recovery key')"
					placeholder="XXXX-XXXX-XXXX-…"
					resize="none"
					:rows="2"
					spellcheck="false"
					autocomplete="off" />
				<PasswordInput v-model="newPassword" :label="t('vpass', 'New master password')" :generator="false" show-feedback autocomplete="off" />
				<NcPasswordField v-model="confirm"
					:label="t('vpass', 'Repeat new master password')"
					autocomplete="off"
					:error="confirm.length > 0 && confirm !== newPassword"
					:helper-text="confirm.length > 0 && confirm !== newPassword ? t('vpass', 'The passwords do not match') : ''" />
				<NcNoteCard v-if="error" type="error">
					{{ error }}
				</NcNoteCard>
				<NcButton variant="primary" type="submit" wide :disabled="!canRecover || busy">
					<template #icon>
						<NcLoadingIcon v-if="busy" :size="20" />
					</template>
					{{ t('vpass', 'Set new password and unlock') }}
				</NcButton>
				<div class="gate__links">
					<NcButton variant="tertiary" @click="mode = 'password'; error = ''">
						{{ t('vpass', 'Back') }}
					</NcButton>
				</div>
			</form>
		</div>
	</div>
</template>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcPasswordField from '@nextcloud/vue/components/NcPasswordField'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'
import { InvalidRecoveryKeyError, WrongPasswordError } from '@vpass/core'
import { computed, nextTick, onMounted, ref } from 'vue'
import FingerprintIcon from 'vue-material-design-icons/Fingerprint.vue'
import LockOpenIcon from 'vue-material-design-icons/LockOpenVariant.vue'
import ShieldLockIcon from 'vue-material-design-icons/ShieldLock.vue'
import PasswordInput from '../components/PasswordInput.vue'
import { useStrength } from '../composables/useStrength.ts'
import { webauthnAvailable } from '../services/webauthn.ts'
import { useSessionStore } from '../stores/session.ts'

const session = useSessionStore()
const mode = ref<'password' | 'recover'>('password')
const password = ref('')
const busy = ref(false)
const error = ref('')
const passwordField = ref<{ $el: HTMLElement }>()

const recoveryKey = ref('')
const newPassword = ref('')
const confirm = ref('')
const strength = useStrength(newPassword)

const canUsePasskey = computed(() => webauthnAvailable() && session.unlockKeys.length > 0)
const canRecover = computed(() => recoveryKey.value.trim().length > 0
	&& newPassword.value.length >= 10 && (strength.value?.score ?? 0) >= 3 && newPassword.value === confirm.value)

onMounted(async () => {
	await nextTick()
	passwordField.value?.$el.querySelector('input')?.focus()
})

async function unlock(): Promise<void> {
	busy.value = true
	error.value = ''
	try {
		await session.unlock(password.value)
		password.value = ''
	} catch (e) {
		error.value = e instanceof WrongPasswordError ? t('vpass', 'That master password is not correct') : (e as Error).message
	} finally {
		busy.value = false
	}
}

async function unlockWithPasskey(): Promise<void> {
	busy.value = true
	error.value = ''
	try {
		await session.unlockWithPasskey()
	} catch (e) {
		const err = e as Error
		error.value = err.name === 'NotAllowedError' ? t('vpass', 'Passkey unlock was cancelled') : err.message
	} finally {
		busy.value = false
	}
}

async function recover(): Promise<void> {
	busy.value = true
	error.value = ''
	try {
		await session.recover(recoveryKey.value, newPassword.value)
		recoveryKey.value = newPassword.value = confirm.value = ''
	} catch (e) {
		error.value = e instanceof InvalidRecoveryKeyError ? e.message : t('vpass', 'Recovery failed: {error}', { error: (e as Error).message })
	} finally {
		busy.value = false
	}
}
</script>
