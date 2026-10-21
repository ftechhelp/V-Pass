<template>
	<div class="detail">
		<div class="head">
			<button class="icon-btn" title="Back" @click="emit('back')"><ArrowLeftIcon :size="20" /></button>
			<h2 class="grow ellipsis">{{ entry.item.title || '(untitled)' }}</h2>
			<button v-if="fillable" class="btn primary" data-test="detail-fill" @click="emit('fill', entry.id)">Fill</button>
		</div>
		<p v-if="entry.folderName" class="muted small folder">In {{ entry.folderName }}</p>

		<template v-if="login">
			<FieldRow label="Username" :value="login.username" />
			<FieldRow label="Password" :value="login.password" secret />
			<FieldRow v-if="login.totp" label="One-time code" :value="totpNow || '…'" :copy-value="totpNow">
				<TotpCode :item-id="entry.id" @code="totpNow = $event" />
				<template #actions>
					<button class="icon-btn" title="Replace with a QR code on this page" data-test="detail-scan-qr" @click="emit('scan', entry.id)"><QrcodeScanIcon :size="18" /></button>
				</template>
			</FieldRow>
			<div v-else class="block row">
				<span class="grow label">One-time code</span>
				<button class="btn link" data-test="detail-scan-qr" @click="emit('scan', entry.id)"><QrcodeScanIcon :size="18" /> Scan QR code</button>
			</div>
			<div v-if="login.urls.length" class="block">
				<div class="label">Websites</div>
				<a v-for="url in login.urls" :key="url" class="url ellipsis" :href="normaliseUrl(url)" target="_blank" rel="noopener noreferrer">{{ url }}</a>
			</div>
			<div v-if="login.passkeys.length" class="block" data-test="detail-passkeys">
				<div class="label">Passkeys</div>
				<div v-for="pk in login.passkeys" :key="pk.credentialId" class="row passkey">
					<FingerprintIcon :size="18" class="muted" />
					<span class="grow ellipsis">{{ pk.userName || pk.userDisplayName || 'Passkey' }} · {{ pk.rpId }}</span>
				</div>
			</div>
		</template>

		<template v-else-if="card">
			<FieldRow label="Cardholder" :value="card.cardholderName" />
			<FieldRow label="Number" :value="formatCardNumber(card.number)" :copy-value="card.number.replace(/\s+/g, '')" secret />
			<FieldRow label="Expires" :value="card.expMonth && card.expYear ? `${card.expMonth}/${card.expYear}` : ''" />
			<FieldRow label="Security code" :value="card.cvc" secret />
			<FieldRow label="PIN" :value="card.pin" secret />
			<FieldRow label="ZIP / postal code" :value="card.zip" />
		</template>

		<template v-else-if="identity">
			<FieldRow label="Name" :value="fullName(identity)" />
			<FieldRow label="Email" :value="identity.email" />
			<FieldRow label="Phone" :value="identity.phone" />
			<FieldRow label="Company" :value="identity.company" />
			<FieldRow label="Address" :value="address" multiline />
			<FieldRow label="Birthday" :value="identity.birthday" />
		</template>

		<FieldRow v-for="(field, i) in entry.item.customFields" :key="i" :label="field.label || 'Field'" :value="field.value" :secret="field.type === 'hidden'" />
		<FieldRow label="Notes" :value="entry.item.notes" multiline />
	</div>
</template>

<script setup lang="ts">
import { type CardItem, type IdentityItem, type LoginItem, formatCardNumber, fullName, normaliseUrl } from '@vpass/core'
import { computed, ref } from 'vue'
import ArrowLeftIcon from 'vue-material-design-icons/ArrowLeft.vue'
import FingerprintIcon from 'vue-material-design-icons/Fingerprint.vue'
import QrcodeScanIcon from 'vue-material-design-icons/QrcodeScan.vue'
import type { ItemView } from '../../shared/protocol.ts'
import TotpCode from '../ui/TotpCode.vue'
import FieldRow from './FieldRow.vue'

const props = defineProps<{ entry: ItemView }>()
const emit = defineEmits<{ back: [], fill: [itemId: string], scan: [itemId: string] }>()

const totpNow = ref('')
// Typed views: templates don't narrow the item union.
const login = computed<LoginItem | null>(() => props.entry.item.type === 'login' ? props.entry.item : null)
const card = computed<CardItem | null>(() => props.entry.item.type === 'card' ? props.entry.item : null)
const identity = computed<IdentityItem | null>(() => props.entry.item.type === 'identity' ? props.entry.item : null)
const fillable = computed(() => props.entry.item.type !== 'note')
const address = computed(() => {
	const i = identity.value
	if (!i) return ''
	return [i.address1, i.address2, [i.zip, i.city].filter(Boolean).join(' '), i.state, i.country].filter(Boolean).join('\n')
})
</script>

<style scoped>
.head {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 4px;
}

.folder {
	margin: 0 0 6px 38px;
}

.block {
	padding: 6px 4px;
	border-bottom: 1px solid var(--border);
}

.label {
	font-size: 12px;
	color: var(--text-muted);
}

.url {
	display: block;
}

.passkey {
	padding: 2px 0;
}
</style>
