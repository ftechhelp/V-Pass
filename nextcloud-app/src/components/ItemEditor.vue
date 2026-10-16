<template>
	<form class="item-editor" data-test="item-editor" @submit.prevent="save" @keydown="onKeydown">
		<header class="item-editor__header">
			<ItemIcon :item="draft" size="large" />
			<h2 class="item-editor__title">
				{{ isNew ? t('vpass', 'New {type}', { type: ITEM_TYPE_INFO[draft.type].label.toLowerCase() }) : t('vpass', 'Edit item') }}
			</h2>
		</header>

		<div v-if="isNew" class="item-editor__types" role="radiogroup" :aria-label="t('vpass', 'Item type')">
			<NcCheckboxRadioSwitch v-for="info in Object.values(ITEM_TYPE_INFO)"
				:key="info.type"
				:model-value="draft.type"
				type="radio"
				:value="info.type"
				name="item-type"
				button-variant
				button-variant-grouped="horizontal"
				@update:model-value="changeType(info.type)">
				{{ info.label }}
			</NcCheckboxRadioSwitch>
		</div>

		<NcTextField v-model="draft.title"
			:label="t('vpass', 'Title')"
			:placeholder="titlePlaceholder"
			data-test="field-title"
			autofocus />

		<!-- Login -->
		<template v-if="login">
			<NcTextField v-model="login.username" :label="t('vpass', 'Username or email')" autocomplete="off" data-test="field-username" />
			<PasswordInput v-model="login.password" :label="t('vpass', 'Password')" :user-inputs="[login.username, login.title]" data-test="field-password" />
			<h3 class="item-editor__section">
				{{ t('vpass', 'Websites') }}
			</h3>
			<UrlsEditor v-model="login.urls" />
			<h3 class="item-editor__section">
				{{ t('vpass', 'Two-factor authentication') }}
			</h3>
			<TotpInput v-model="login.totp" />
			<PasskeyList v-model="login.passkeys" editable />
		</template>

		<!-- Credit card -->
		<template v-else-if="card">
			<NcTextField v-model="card.cardholderName" :label="t('vpass', 'Cardholder name')" autocomplete="off" />
			<NcTextField v-model="cardNumber"
				:label="t('vpass', 'Card number')"
				inputmode="numeric"
				autocomplete="off"
				:helper-text="cardHint"
				:error="cardInvalid" />
			<div class="item-editor__row">
				<NcSelect v-model="card.expMonth" :options="months" :input-label="t('vpass', 'Expiry month')" :placeholder="t('vpass', 'MM')" />
				<NcSelect v-model="card.expYear" :options="years" :input-label="t('vpass', 'Expiry year')" :placeholder="t('vpass', 'YYYY')" />
			</div>
			<div class="item-editor__row">
				<NcPasswordField v-model="card.cvc" :label="t('vpass', 'Security code (CVC)')" autocomplete="off" inputmode="numeric" />
				<NcPasswordField v-model="card.pin" :label="t('vpass', 'PIN')" autocomplete="off" inputmode="numeric" />
			</div>
			<NcTextField v-model="card.zip" :label="t('vpass', 'ZIP / postal code')" autocomplete="off" />
		</template>

		<!-- Personal info -->
		<template v-else-if="identity">
			<div class="item-editor__row">
				<NcTextField v-model="identity.firstName" :label="t('vpass', 'First name')" autocomplete="off" />
				<NcTextField v-model="identity.middleName" :label="t('vpass', 'Middle name')" autocomplete="off" />
				<NcTextField v-model="identity.lastName" :label="t('vpass', 'Last name')" autocomplete="off" />
			</div>
			<div class="item-editor__row">
				<NcTextField v-model="identity.email" :label="t('vpass', 'Email')" type="email" autocomplete="off" />
				<NcTextField v-model="identity.phone" :label="t('vpass', 'Phone')" type="tel" autocomplete="off" />
			</div>
			<NcTextField v-model="identity.company" :label="t('vpass', 'Company')" autocomplete="off" />
			<NcTextField v-model="identity.address1" :label="t('vpass', 'Address line 1')" autocomplete="off" />
			<NcTextField v-model="identity.address2" :label="t('vpass', 'Address line 2')" autocomplete="off" />
			<div class="item-editor__row">
				<NcTextField v-model="identity.city" :label="t('vpass', 'City')" autocomplete="off" />
				<NcTextField v-model="identity.state" :label="t('vpass', 'State / region')" autocomplete="off" />
			</div>
			<div class="item-editor__row">
				<NcTextField v-model="identity.zip" :label="t('vpass', 'ZIP / postal code')" autocomplete="off" />
				<NcTextField v-model="identity.country" :label="t('vpass', 'Country')" autocomplete="off" />
			</div>
			<NcTextField v-model="identity.birthday" :label="t('vpass', 'Birthday')" :placeholder="t('vpass', 'YYYY-MM-DD')" autocomplete="off" />
		</template>

		<NcTextArea v-model="draft.notes"
			:label="draft.type === 'note' ? t('vpass', 'Note') : t('vpass', 'Notes')"
			resize="vertical"
			:rows="draft.type === 'note' ? 10 : 3"
			data-test="field-notes" />

		<h3 class="item-editor__section">
			{{ t('vpass', 'Custom fields') }}
		</h3>
		<CustomFieldsEditor v-model="draft.customFields" />

		<h3 class="item-editor__section">
			{{ t('vpass', 'Organize') }}
		</h3>
		<NcSelect v-model="folderOption"
			:options="folderOptions"
			:input-label="t('vpass', 'Folder')"
			:clearable="false" />
		<NcCheckboxRadioSwitch v-model="draft.favorite">
			{{ t('vpass', 'Favorite') }}
		</NcCheckboxRadioSwitch>

		<footer class="item-editor__footer">
			<NcButton @click="cancel">
				{{ t('vpass', 'Cancel') }}
			</NcButton>
			<NcButton variant="primary" type="submit" :disabled="saving" data-test="save-item">
				<template #icon>
					<NcLoadingIcon v-if="saving" :size="20" />
					<CheckIcon v-else :size="20" />
				</template>
				{{ t('vpass', 'Save') }}
			</NcButton>
		</footer>
	</form>
</template>

<script setup lang="ts">
import { showError, showSuccess, showWarning } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcPasswordField from '@nextcloud/vue/components/NcPasswordField'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import {
	type Item,
	type ItemType,
	ConflictError,
	cardBrand,
	formatCardNumber,
	hostnameOf,
	itemDisplayTitle,
	luhnValid,
	newItem,
	parseTotp,
} from '@vpass/core'
import { computed, ref } from 'vue'
import CheckIcon from 'vue-material-design-icons/Check.vue'
import { confirmAction } from '../services/browser.ts'
import { type VaultEntry, useVaultStore } from '../stores/vault.ts'
import { ITEM_TYPE_INFO } from '../utils/itemTypes.ts'
import CustomFieldsEditor from './CustomFieldsEditor.vue'
import ItemIcon from './ItemIcon.vue'
import PasskeyList from './PasskeyList.vue'
import PasswordInput from './PasswordInput.vue'
import TotpInput from './TotpInput.vue'
import UrlsEditor from './UrlsEditor.vue'

const props = defineProps<{
	/** Existing entry to edit; omit to create a new item. */
	entry?: VaultEntry
	type?: ItemType
	folderId?: string | null
}>()

const emit = defineEmits<{ saved: [id: string], cancel: [] }>()
const store = useVaultStore()

const isNew = computed(() => !props.entry)
const initial: Item = props.entry
	? structuredClone(props.entry.item)
	: newItem(props.type ?? 'login', { folderId: props.folderId ?? null })
const draft = ref<Item>(structuredClone(initial))
const saving = ref(false)

const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(initial))

/** Typed views of the draft, so the template can bind type-specific fields. */
const login = computed(() => (draft.value.type === 'login' ? draft.value : null))
const card = computed(() => (draft.value.type === 'card' ? draft.value : null))
const identity = computed(() => (draft.value.type === 'identity' ? draft.value : null))

function changeType(type: ItemType): void {
	const { title, notes, folderId, favorite, customFields } = draft.value
	draft.value = newItem(type, { title, notes, folderId, favorite, customFields })
}

const titlePlaceholder = computed(() => {
	const d = draft.value
	if (d.type === 'login' && d.urls[0]) return hostnameOf(d.urls[0])
	return { login: 'e.g. Gmail', note: 'e.g. Wi-Fi password', card: 'e.g. Visa Gold', identity: 'e.g. Personal' }[d.type]
})

/* ----- card helpers ----- */

const cardNumber = computed({
	get: () => (draft.value.type === 'card' ? formatCardNumber(draft.value.number) : ''),
	set: (value: string) => {
		if (draft.value.type === 'card') draft.value.number = value.replace(/\D/g, '').slice(0, 19)
	},
})
const cardInvalid = computed(() => draft.value.type === 'card' && draft.value.number.length >= 12 && !luhnValid(draft.value.number))
const cardHint = computed(() => {
	if (draft.value.type !== 'card' || !draft.value.number) return ''
	if (cardInvalid.value) return t('vpass', 'This card number looks mistyped')
	const brand = cardBrand(draft.value.number)
	return brand === 'unknown' ? '' : brand.charAt(0).toUpperCase() + brand.slice(1)
})
const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
const thisYear = new Date().getFullYear()
const years = Array.from({ length: 21 }, (_, i) => String(thisYear - 5 + i))

/* ----- folder ----- */

interface FolderOption { id: string | null, label: string }
const folderOptions = computed<FolderOption[]>(() => [
	{ id: null, label: t('vpass', 'No folder') },
	...store.folderList.map((f) => ({ id: f.id, label: f.name })),
])
const folderOption = computed<FolderOption>({
	get: () => folderOptions.value.find((o) => o.id === draft.value.folderId) ?? folderOptions.value[0]!,
	set: (option) => {
		draft.value.folderId = option?.id ?? null
	},
})

/* ----- save ----- */

function normalise(item: Item): Item {
	const out = structuredClone(item)
	out.title = out.title.trim()
	out.customFields = out.customFields.filter((f) => f.label.trim() || f.value)
	if (out.type === 'login') {
		out.urls = out.urls.map((u) => u.trim()).filter(Boolean)
		out.totp = out.totp.trim()
	}
	if (!out.title) {
		const derived = itemDisplayTitle(out)
		out.title = derived === 'Untitled' ? '' : derived
	}
	return out
}

async function save(): Promise<void> {
	const item = normalise(draft.value)
	if (!item.title) {
		showWarning(t('vpass', 'Please give this item a title'))
		return
	}
	if (item.type === 'login' && item.totp) {
		try {
			parseTotp(item.totp)
		} catch {
			showWarning(t('vpass', 'The authenticator key is not valid'))
			return
		}
	}
	saving.value = true
	try {
		const saved = props.entry ? await store.saveItem(props.entry.id, item) : await store.createItem(item)
		showSuccess(isNew.value ? t('vpass', 'Item added') : t('vpass', 'Changes saved'))
		emit('saved', saved.id)
	} catch (e) {
		if (e instanceof ConflictError) {
			showError(t('vpass', 'This item was changed on another device. The latest version has been loaded; please make your changes again.'))
			emit('cancel')
		} else {
			showError(t('vpass', 'Could not save: {error}', { error: (e as Error).message }))
		}
	} finally {
		saving.value = false
	}
}

async function cancel(): Promise<void> {
	if (dirty.value && !await confirmAction(t('vpass', 'Discard changes?'), t('vpass', 'Your changes to this item will be lost.'), t('vpass', 'Discard'))) {
		return
	}
	emit('cancel')
}

function onKeydown(event: KeyboardEvent): void {
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
		event.preventDefault()
		save()
	} else if (event.key === 'Escape') {
		cancel()
	}
}
</script>

<style scoped lang="scss">
.item-editor {
	display: flex;
	flex-direction: column;
	gap: 10px;
	max-width: 760px;
	margin: 0 auto;
	padding: 20px 20px 40px;

	&__header {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	&__title {
		margin: 0;
		font-size: 1.5em;
	}

	&__types {
		display: flex;
		flex-wrap: wrap;
	}

	&__section {
		margin: 14px 0 0;
		font-size: 1em;
		font-weight: 600;
	}

	&__row {
		display: flex;
		gap: 10px;

		> * {
			flex: 1;
			min-width: 0;
		}

		@media (max-width: 600px) {
			flex-direction: column;
		}
	}

	&__footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		position: sticky;
		bottom: 0;
		padding: 12px 0;
		background: var(--color-main-background);
		border-top: 1px solid var(--color-border);
	}
}
</style>
