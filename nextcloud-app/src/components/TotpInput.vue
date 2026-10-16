<template>
	<div class="totp-input">
		<div class="totp-input__row">
			<NcTextField v-model="model"
				class="totp-input__field"
				:label="t('vpass', 'Authenticator key (2FA)')"
				:placeholder="t('vpass', 'Secret key or otpauth:// link')"
				:error="invalid"
				:helper-text="invalid ? t('vpass', 'This is not a valid authenticator key') : ''"
				autocomplete="off"
				spellcheck="false" />
			<NcButton variant="secondary"
				:aria-label="t('vpass', 'Read QR code from an image')"
				:title="t('vpass', 'Read QR code from a screenshot')"
				@click="fileInput?.click()">
				<template #icon>
					<QrcodeScanIcon :size="20" />
				</template>
			</NcButton>
			<input ref="fileInput"
				type="file"
				accept="image/*"
				class="hidden-visually"
				@change="readQr">
		</div>
		<TotpDisplay v-if="model && !invalid" :uri="model" />
	</div>
</template>

<script setup lang="ts">
import { showError } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { parseTotp } from '@vpass/core'
import { computed, ref } from 'vue'
import QrcodeScanIcon from 'vue-material-design-icons/QrcodeScan.vue'
import TotpDisplay from './TotpDisplay.vue'

const model = defineModel<string>({ required: true })
const fileInput = ref<HTMLInputElement>()

const invalid = computed(() => {
	if (!model.value.trim()) return false
	try {
		parseTotp(model.value)
		return false
	} catch {
		return true
	}
})

/** Decode a QR code from an uploaded screenshot, entirely in the browser. */
async function readQr(event: Event): Promise<void> {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (!file) return
	try {
		const { default: jsQR } = await import('jsqr')
		const bitmap = await createImageBitmap(file)
		const canvas = document.createElement('canvas')
		canvas.width = bitmap.width
		canvas.height = bitmap.height
		const ctx = canvas.getContext('2d')!
		ctx.drawImage(bitmap, 0, 0)
		const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
		const result = jsQR(image.data, image.width, image.height)
		if (!result?.data) {
			showError(t('vpass', 'No QR code found in this image'))
			return
		}
		parseTotp(result.data)
		model.value = result.data
	} catch {
		showError(t('vpass', 'The QR code does not contain an authenticator key'))
	}
}
</script>

<style scoped lang="scss">
.totp-input__row {
	display: flex;
	align-items: flex-start;
	gap: 8px;
}

.totp-input__field {
	flex: 1;
}
</style>
