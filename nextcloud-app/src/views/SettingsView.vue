<template>
	<NcAppContent :page-heading="t('vpass', 'Settings')">
		<div class="page">
			<h2 class="page__title">
				{{ t('vpass', 'Settings') }}
			</h2>

			<!-- Master password -->
			<section class="settings__section">
				<h3>{{ t('vpass', 'Master password') }}</h3>
				<p class="settings__muted">
					{{ t('vpass', 'Changing it re-encrypts your vault key on this device. Your items stay as they are.') }}
				</p>
				<form class="settings__form" @submit.prevent="changePassword">
					<NcPasswordField v-model="pw.current" :label="t('vpass', 'Current master password')" autocomplete="off" />
					<PasswordInput v-model="pw.next" :label="t('vpass', 'New master password')" :generator="false" show-feedback autocomplete="off" />
					<NcPasswordField v-model="pw.confirm"
						:label="t('vpass', 'Repeat new master password')"
						autocomplete="off"
						:error="pw.confirm.length > 0 && pw.confirm !== pw.next" />
					<NcButton type="submit" variant="primary" :disabled="!canChangePassword || busy === 'password'">
						<template #icon>
							<NcLoadingIcon v-if="busy === 'password'" :size="20" />
						</template>
						{{ t('vpass', 'Change master password') }}
					</NcButton>
				</form>
			</section>

			<!-- Recovery key -->
			<section class="settings__section">
				<h3>{{ t('vpass', 'Recovery key') }}</h3>
				<p class="settings__muted">
					{{ t('vpass', 'Create a new recovery key if you lost the old one or think someone else has seen it. The old key stops working immediately.') }}
				</p>
				<RecoveryKeyBox v-if="newRecoveryKey" :recovery-key="newRecoveryKey" />
				<form v-else class="settings__form" @submit.prevent="regenerateRecovery">
					<NcPasswordField v-model="recoveryPassword" :label="t('vpass', 'Current master password')" autocomplete="off" />
					<NcButton type="submit" :disabled="!recoveryPassword || busy === 'recovery'">
						<template #icon>
							<NcLoadingIcon v-if="busy === 'recovery'" :size="20" />
						</template>
						{{ t('vpass', 'Create new recovery key') }}
					</NcButton>
				</form>
			</section>

			<!-- Passkey unlock -->
			<section class="settings__section">
				<h3>{{ t('vpass', 'Unlock with passkey') }}</h3>
				<p class="settings__muted">
					{{ t('vpass', 'Unlock V-Pass with your fingerprint, face, device PIN or a security key. Requires a passkey that supports the PRF extension (recent Chrome, Edge, Safari and Firefox, Windows Hello, iCloud Keychain, Google Password Manager, YubiKey 5).') }}
				</p>
				<NcNoteCard v-if="!passkeySupported" type="warning">
					{{ t('vpass', 'This browser cannot use passkeys here. Passkeys need HTTPS.') }}
				</NcNoteCard>
				<ul v-if="session.unlockKeys.length" class="settings__keys">
					<li v-for="key in session.unlockKeys" :key="key.id">
						<FingerprintIcon :size="24" />
						<div class="settings__key-text">
							<strong>{{ key.label }}</strong>
							<span class="settings__muted">
								{{ t('vpass', 'Added {date}', { date: new Date(key.createdAt * 1000).toLocaleDateString() }) }}
								<template v-if="key.lastUsedAt"> · {{ t('vpass', 'last used {date}', { date: new Date(key.lastUsedAt * 1000).toLocaleDateString() }) }}</template>
							</span>
						</div>
						<NcButton variant="tertiary" :aria-label="t('vpass', 'Remove')" :title="t('vpass', 'Remove')" @click="removePasskey(key.id, key.label)">
							<template #icon>
								<DeleteIcon :size="20" />
							</template>
						</NcButton>
					</li>
				</ul>
				<form v-if="passkeySupported" class="settings__inline" @submit.prevent="addPasskey">
					<NcTextField v-model="passkeyLabel" :label="t('vpass', 'Name (e.g. “Laptop fingerprint”)')" />
					<NcButton type="submit" :disabled="busy === 'passkey'">
						<template #icon>
							<NcLoadingIcon v-if="busy === 'passkey'" :size="20" />
							<PlusIcon v-else :size="20" />
						</template>
						{{ t('vpass', 'Add passkey') }}
					</NcButton>
				</form>
			</section>

			<!-- Preferences -->
			<section class="settings__section">
				<h3>{{ t('vpass', 'Auto-lock and clipboard') }}</h3>
				<div class="settings__row">
					<NcSelect v-model="autoLock" :options="autoLockOptions" :input-label="t('vpass', 'Lock after inactivity')" :clearable="false" />
					<NcSelect v-model="clipboard" :options="clipboardOptions" :input-label="t('vpass', 'Clear copied passwords after')" :clearable="false" />
				</div>
				<NcCheckboxRadioSwitch v-model="prefs.lockOnHide" type="switch">
					{{ t('vpass', 'Lock when I switch to another tab or minimize the window') }}
				</NcCheckboxRadioSwitch>
			</section>

			<!-- Danger zone -->
			<section class="settings__section settings__section--danger">
				<h3>{{ t('vpass', 'Delete vault') }}</h3>
				<p class="settings__muted">
					{{ t('vpass', 'Permanently delete your vault, every item and all attached files. Export a backup first if you might need them.') }}
				</p>
				<NcButton variant="error" :disabled="busy === 'delete'" @click="deleteVault">
					<template #icon>
						<DeleteForeverIcon :size="20" />
					</template>
					{{ t('vpass', 'Delete my vault') }}
				</NcButton>
			</section>
		</div>
	</NcAppContent>
</template>

<script setup lang="ts">
import { showError, showSuccess } from '@nextcloud/dialogs'
import { n, t } from '@nextcloud/l10n'
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcPasswordField from '@nextcloud/vue/components/NcPasswordField'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { WrongPasswordError } from '@vpass/core'
import { computed, reactive, ref } from 'vue'
import DeleteForeverIcon from 'vue-material-design-icons/DeleteForever.vue'
import DeleteIcon from 'vue-material-design-icons/DeleteOutline.vue'
import FingerprintIcon from 'vue-material-design-icons/Fingerprint.vue'
import PlusIcon from 'vue-material-design-icons/Plus.vue'
import PasswordInput from '../components/PasswordInput.vue'
import RecoveryKeyBox from '../components/RecoveryKeyBox.vue'
import { useStrength } from '../composables/useStrength.ts'
import { confirmAction } from '../services/browser.ts'
import { PrfUnsupportedError, webauthnAvailable } from '../services/webauthn.ts'
import { usePreferencesStore } from '../stores/preferences.ts'
import { useSessionStore } from '../stores/session.ts'

const session = useSessionStore()
const prefs = usePreferencesStore()
const passkeySupported = webauthnAvailable()
const busy = ref<'password' | 'recovery' | 'passkey' | 'delete' | null>(null)

function errorMessage(e: unknown): string {
	return e instanceof WrongPasswordError ? t('vpass', 'The current master password is not correct') : (e as Error).message
}

/* ----- master password ----- */

const pw = reactive({ current: '', next: '', confirm: '' })
const strength = useStrength(() => pw.next)
const canChangePassword = computed(() => pw.current && pw.next.length >= 10 && (strength.value?.score ?? 0) >= 3 && pw.next === pw.confirm)

async function changePassword(): Promise<void> {
	busy.value = 'password'
	try {
		await session.changeMasterPassword(pw.current, pw.next)
		pw.current = pw.next = pw.confirm = ''
		showSuccess(t('vpass', 'Master password changed'))
	} catch (e) {
		showError(errorMessage(e))
	} finally {
		busy.value = null
	}
}

/* ----- recovery key ----- */

const recoveryPassword = ref('')
const newRecoveryKey = ref('')

async function regenerateRecovery(): Promise<void> {
	busy.value = 'recovery'
	try {
		newRecoveryKey.value = await session.regenerateRecoveryKey(recoveryPassword.value)
		recoveryPassword.value = ''
		showSuccess(t('vpass', 'New recovery key created. Save it now — it is only shown once.'))
	} catch (e) {
		showError(errorMessage(e))
	} finally {
		busy.value = null
	}
}

/* ----- passkeys ----- */

const passkeyLabel = ref('')

async function addPasskey(): Promise<void> {
	busy.value = 'passkey'
	try {
		await session.addPasskeyUnlock(passkeyLabel.value.trim() || t('vpass', 'Passkey'))
		passkeyLabel.value = ''
		showSuccess(t('vpass', 'Passkey added. You can now unlock V-Pass with it.'))
	} catch (e) {
		const err = e as Error
		showError(e instanceof PrfUnsupportedError ? err.message : err.name === 'NotAllowedError' ? t('vpass', 'Passkey setup was cancelled') : err.message)
	} finally {
		busy.value = null
	}
}

async function removePasskey(id: number, label: string): Promise<void> {
	if (!await confirmAction(t('vpass', 'Remove passkey?'), t('vpass', '"{label}" will no longer unlock your vault.', { label }), t('vpass', 'Remove'))) return
	try {
		await session.removePasskeyUnlock(id)
	} catch (e) {
		showError((e as Error).message)
	}
}

/* ----- preferences ----- */

interface Option { id: number, label: string }
const autoLockOptions: Option[] = [
	...[1, 5, 15, 30, 60, 240].map((m) => ({ id: m, label: n('vpass', '%n minute', '%n minutes', m) })),
	{ id: 0, label: t('vpass', 'Never (only when I lock or reload)') },
]
const clipboardOptions: Option[] = [
	...[15, 30, 60, 120].map((s) => ({ id: s, label: n('vpass', '%n second', '%n seconds', s) })),
	{ id: 0, label: t('vpass', 'Never') },
]
const autoLock = computed<Option>({
	get: () => autoLockOptions.find((o) => o.id === prefs.autoLockMinutes) ?? autoLockOptions[2]!,
	set: (o) => {
		prefs.autoLockMinutes = o.id
		session.resetAutoLockTimer()
	},
})
const clipboard = computed<Option>({
	get: () => clipboardOptions.find((o) => o.id === prefs.clipboardClearSeconds) ?? clipboardOptions[1]!,
	set: (o) => {
		prefs.clipboardClearSeconds = o.id
	},
})

/* ----- delete ----- */

async function deleteVault(): Promise<void> {
	const confirmed = await confirmAction(
		t('vpass', 'Delete your vault permanently?'),
		t('vpass', 'Every item, folder and file in V-Pass will be destroyed. This cannot be undone, not even by your administrator.'),
		t('vpass', 'Delete everything'),
	)
	if (!confirmed) return
	busy.value = 'delete'
	try {
		await session.deleteVault()
		showSuccess(t('vpass', 'Your vault was deleted'))
	} catch (e) {
		showError((e as Error).message)
	} finally {
		busy.value = null
	}
}
</script>

<style scoped lang="scss">
.settings {
	&__section {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 18px 0;
		border-bottom: 1px solid var(--color-border);

		h3 {
			margin: 0;
			font-size: 1.15em;
		}

		&--danger h3 {
			color: var(--color-error-text);
		}

		> .button-vue {
			align-self: flex-start;
		}
	}

	&__muted {
		color: var(--color-text-maxcontrast);
		margin: 0;
	}

	&__form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-width: 480px;

		> .button-vue {
			align-self: flex-start;
		}
	}

	&__inline {
		display: flex;
		gap: 8px;
		align-items: flex-end;
		max-width: 520px;

		> :first-child {
			flex: 1;
		}
	}

	&__row {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;

		> * {
			flex: 1;
			min-width: 220px;
		}
	}

	&__keys li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 0;
	}

	&__key-text {
		display: flex;
		flex-direction: column;
		flex: 1;
	}
}
</style>
