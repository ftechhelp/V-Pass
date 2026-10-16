<template>
	<div class="gate">
		<div class="gate__card" data-test="setup">
			<div class="gate__logo">
				<ShieldLockIcon :size="48" />
				<span>V-Pass</span>
			</div>
			<ol class="steps" :aria-label="t('vpass', 'Setup progress')">
				<li v-for="(label, i) in stepLabels" :key="label" :class="{ 'steps__step--active': step === i + 1, 'steps__step--done': step > i + 1 }" class="steps__step">
					<span class="steps__number">{{ i + 1 }}</span> {{ label }}
				</li>
			</ol>

			<!-- Step 1: master password -->
			<form v-if="step === 1" class="gate__form" @submit.prevent="create">
				<h2>{{ t('vpass', 'Create your master password') }}</h2>
				<p>
					{{ t('vpass', 'This is the only password you need to remember. It encrypts your vault on this device: V-Pass and your Nextcloud administrator never see it, so it cannot be reset.') }}
				</p>
				<PasswordInput v-model="password"
					:label="t('vpass', 'Master password')"
					:generator="false"
					show-feedback
					:user-inputs="userInputs"
					autocomplete="off"
					data-test="master-password" />
				<NcPasswordField v-model="confirm"
					:label="t('vpass', 'Repeat master password')"
					autocomplete="off"
					:error="confirm.length > 0 && confirm !== password"
					:helper-text="confirm.length > 0 && confirm !== password ? t('vpass', 'The passwords do not match') : ''"
					data-test="master-password-confirm" />
				<NcNoteCard type="info">
					{{ t('vpass', 'Tip: a passphrase of four or more random words (like "orbit-velvet-cactus-lantern") is strong and easy to remember.') }}
				</NcNoteCard>
				<p v-if="password && !strongEnough" class="gate__hint">
					{{ t('vpass', 'Use at least 10 characters and reach "Strong" on the meter.') }}
				</p>
				<NcButton variant="primary" type="submit" wide :disabled="!canCreate || busy" data-test="create-vault">
					<template #icon>
						<NcLoadingIcon v-if="busy" :size="20" />
					</template>
					{{ busy ? t('vpass', 'Creating your encrypted vault…') : t('vpass', 'Continue') }}
				</NcButton>
			</form>

			<!-- Step 2: recovery key -->
			<div v-else-if="step === 2" class="gate__form">
				<h2>{{ t('vpass', 'Save your recovery key') }}</h2>
				<p>
					{{ t('vpass', 'If you ever forget your master password, this key is the only way back into your vault. Keep it somewhere safe and offline, for example printed out at home.') }}
				</p>
				<RecoveryKeyBox :recovery-key="recoveryKey" />
				<NcCheckboxRadioSwitch v-model="savedKey" data-test="saved-recovery-key">
					{{ t('vpass', 'I have saved my recovery key somewhere safe') }}
				</NcCheckboxRadioSwitch>
				<NcButton variant="primary" wide :disabled="!savedKey" data-test="recovery-continue" @click="step = 3">
					{{ t('vpass', 'Continue') }}
				</NcButton>
			</div>

			<!-- Step 3: extras -->
			<div v-else class="gate__form">
				<h2>{{ t('vpass', 'You are all set!') }}</h2>
				<div v-if="passkeySupported" class="option">
					<FingerprintIcon :size="32" class="option__icon" />
					<div class="option__text">
						<strong>{{ t('vpass', 'Unlock with a passkey') }}</strong>
						<p>{{ t('vpass', 'Use your fingerprint, face, device PIN or security key instead of typing your master password.') }}</p>
					</div>
					<NcButton :disabled="passkeyBusy || passkeyAdded" @click="addPasskey">
						<template #icon>
							<CheckIcon v-if="passkeyAdded" :size="20" />
							<NcLoadingIcon v-else-if="passkeyBusy" :size="20" />
						</template>
						{{ passkeyAdded ? t('vpass', 'Added') : t('vpass', 'Set up') }}
					</NcButton>
				</div>
				<div class="option">
					<ImportIcon :size="32" class="option__icon" />
					<div class="option__text">
						<strong>{{ t('vpass', 'Import from NordPass') }}</strong>
						<p>{{ t('vpass', 'Bring over your passwords, notes, cards and personal info from a NordPass CSV export.') }}</p>
					</div>
					<NcButton @click="finish('import')">
						{{ t('vpass', 'Import') }}
					</NcButton>
				</div>
				<NcButton variant="primary" wide data-test="finish-setup" @click="finish()">
					{{ t('vpass', 'Open my vault') }}
				</NcButton>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { getCurrentUser } from '@nextcloud/auth'
import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcPasswordField from '@nextcloud/vue/components/NcPasswordField'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import CheckIcon from 'vue-material-design-icons/Check.vue'
import FingerprintIcon from 'vue-material-design-icons/Fingerprint.vue'
import ImportIcon from 'vue-material-design-icons/Import.vue'
import ShieldLockIcon from 'vue-material-design-icons/ShieldLock.vue'
import PasswordInput from '../components/PasswordInput.vue'
import RecoveryKeyBox from '../components/RecoveryKeyBox.vue'
import { useStrength } from '../composables/useStrength.ts'
import { PrfUnsupportedError, webauthnAvailable } from '../services/webauthn.ts'
import { useSessionStore } from '../stores/session.ts'

const session = useSessionStore()
const router = useRouter()
const user = getCurrentUser()

const stepLabels = [t('vpass', 'Master password'), t('vpass', 'Recovery key'), t('vpass', 'Finish')]
const step = ref(1)
const password = ref('')
const confirm = ref('')
const busy = ref(false)
const recoveryKey = ref('')
const savedKey = ref(false)
const passkeySupported = webauthnAvailable()
const passkeyBusy = ref(false)
const passkeyAdded = ref(false)

const userInputs = [user?.uid ?? '', user?.displayName ?? '', 'vpass', 'nextcloud']
const strength = useStrength(password, userInputs)
const strongEnough = computed(() => password.value.length >= 10 && (strength.value?.score ?? 0) >= 3)
const canCreate = computed(() => strongEnough.value && password.value === confirm.value)

async function create(): Promise<void> {
	if (!canCreate.value) return
	busy.value = true
	try {
		recoveryKey.value = await session.createVault(password.value)
		password.value = ''
		confirm.value = ''
		step.value = 2
	} catch (e) {
		showError(t('vpass', 'Could not create the vault: {error}', { error: (e as Error).message }))
	} finally {
		busy.value = false
	}
}

async function addPasskey(): Promise<void> {
	passkeyBusy.value = true
	try {
		await session.addPasskeyUnlock(t('vpass', 'Passkey added during setup'))
		passkeyAdded.value = true
		showSuccess(t('vpass', 'Passkey unlock is ready'))
	} catch (e) {
		showError(e instanceof PrfUnsupportedError ? e.message : t('vpass', 'Passkey setup failed: {error}', { error: (e as Error).message }))
	} finally {
		passkeyBusy.value = false
	}
}

function finish(next?: 'import'): void {
	recoveryKey.value = ''
	session.finishOnboarding()
	router.push(next === 'import' ? { name: 'import' } : { name: 'category', params: { category: 'all' } })
}
</script>


<style scoped lang="scss">
.steps {
	display: flex;
	gap: 8px;
	justify-content: space-between;
	margin-bottom: 20px;
	font-size: 0.9em;
	color: var(--color-text-maxcontrast);

	&__step {
		display: flex;
		align-items: center;
		gap: 6px;

		&--active {
			color: var(--color-main-text);
			font-weight: 600;
		}
	}

	&__number {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--color-background-darker);

		.steps__step--active & {
			background: var(--color-primary-element);
			color: var(--color-primary-element-text);
		}

		.steps__step--done & {
			background: var(--color-success);
			color: #fff;
		}
	}
}

.option {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px;
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large);

	&__icon {
		color: var(--color-primary-element);
	}

	&__text {
		flex: 1;

		p {
			color: var(--color-text-maxcontrast);
			margin: 2px 0 0;
		}
	}
}
</style>
