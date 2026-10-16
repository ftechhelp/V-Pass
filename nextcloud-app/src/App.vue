<template>
	<NcContent app-name="vpass">
		<template v-if="session.status === 'unlocked' && !session.onboarding">
			<AppNav />
			<RouterView />
		</template>
		<NcAppContent v-else :page-heading="t('vpass', 'V-Pass')">
			<NcEmptyContent v-if="!secureContext"
				:name="t('vpass', 'V-Pass needs a secure connection')"
				:description="t('vpass', 'Open Nextcloud over HTTPS to use V-Pass. Browsers disable the encryption and passkey features it relies on over plain HTTP.')">
				<template #icon>
					<LockAlertIcon />
				</template>
			</NcEmptyContent>
			<NcEmptyContent v-else-if="session.status === 'loading'" :name="t('vpass', 'Loading…')">
				<template #icon>
					<NcLoadingIcon />
				</template>
			</NcEmptyContent>
			<NcEmptyContent v-else-if="session.status === 'error'"
				:name="t('vpass', 'V-Pass could not start')"
				:description="session.error">
				<template #icon>
					<AlertCircleIcon />
				</template>
				<template #action>
					<NcButton @click="session.init()">
						{{ t('vpass', 'Try again') }}
					</NcButton>
				</template>
			</NcEmptyContent>
			<SetupView v-else-if="session.status === 'setup' || session.onboarding" />
			<UnlockView v-else />
		</NcAppContent>
	</NcContent>
</template>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcContent from '@nextcloud/vue/components/NcContent'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { onBeforeUnmount, onMounted } from 'vue'
import AlertCircleIcon from 'vue-material-design-icons/AlertCircleOutline.vue'
import LockAlertIcon from 'vue-material-design-icons/ShieldAlert.vue'
import AppNav from './components/AppNav.vue'
import { useSessionStore } from './stores/session.ts'
import { useVaultStore } from './stores/vault.ts'
import SetupView from './views/SetupView.vue'
import UnlockView from './views/UnlockView.vue'

const session = useSessionStore()
const vault = useVaultStore()
const secureContext = window.isSecureContext

/** Pull changes made on other devices when the tab regains focus. */
function onFocus(): void {
	if (session.status === 'unlocked') {
		vault.sync().catch(() => {})
	}
}

/** Ctrl/Cmd + Shift + L locks the vault from anywhere. */
function onKeydown(event: KeyboardEvent): void {
	if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'l' && session.status === 'unlocked') {
		event.preventDefault()
		session.lock()
	}
}

onMounted(() => {
	if (secureContext) {
		session.init()
	}
	window.addEventListener('focus', onFocus)
	document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
	window.removeEventListener('focus', onFocus)
	document.removeEventListener('keydown', onKeydown)
})
</script>
