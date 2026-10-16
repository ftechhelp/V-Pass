<template>
	<NcSettingsSection :name="t('vpass', 'V-Pass password manager')"
		:description="t('vpass', 'Vaults are end-to-end encrypted: administrators cannot read or recover users\' passwords. A user who loses both their master password and recovery key loses their vault.')">
		<form class="vpass-admin" @submit.prevent="save">
			<NcCheckboxRadioSwitch v-model="settings.hibpEnabled" type="switch">
				{{ t('vpass', 'Allow breach checks with Have I Been Pwned') }}
			</NcCheckboxRadioSwitch>
			<p class="vpass-admin__hint">
				{{ t('vpass', 'The server forwards only the first 5 characters of a password hash to api.pwnedpasswords.com (k-anonymity). Turn this off for air-gapped servers.') }}
			</p>
			<NcTextField v-model="maxAttachmentMb" type="number" :label="t('vpass', 'Maximum attachment size (MB)')" min="1" max="1024" />
			<NcTextField v-model="trashRetentionDays" type="number" :label="t('vpass', 'Delete items from the trash after (days)')" min="1" max="3650" />
			<NcButton type="submit" variant="primary" :disabled="saving">
				{{ t('vpass', 'Save') }}
			</NcButton>
		</form>
	</NcSettingsSection>
</template>

<script setup lang="ts">
import { showError, showSuccess } from '@nextcloud/dialogs'
import { loadState } from '@nextcloud/initial-state'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcSettingsSection from '@nextcloud/vue/components/NcSettingsSection'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import type { AdminSettings } from '@vpass/core'
import { reactive, ref } from 'vue'
import { api } from '../services/api.ts'

const settings = reactive(loadState<AdminSettings>('vpass', 'admin-settings', { hibpEnabled: true, maxAttachmentMb: 50, trashRetentionDays: 30 }))
const maxAttachmentMb = ref(String(settings.maxAttachmentMb))
const trashRetentionDays = ref(String(settings.trashRetentionDays))
const saving = ref(false)

async function save(): Promise<void> {
	saving.value = true
	try {
		Object.assign(settings, await api.updateAdminSettings({
			hibpEnabled: settings.hibpEnabled,
			maxAttachmentMb: Number(maxAttachmentMb.value),
			trashRetentionDays: Number(trashRetentionDays.value),
		}))
		showSuccess(t('vpass', 'Settings saved'))
	} catch (e) {
		showError((e as Error).message)
	} finally {
		saving.value = false
	}
}
</script>

<style scoped>
.vpass-admin {
	display: flex;
	flex-direction: column;
	gap: 12px;
	max-width: 480px;
}

.vpass-admin__hint {
	color: var(--color-text-maxcontrast);
	margin-top: -8px;
}

.vpass-admin > .button-vue {
	align-self: flex-start;
}
</style>
