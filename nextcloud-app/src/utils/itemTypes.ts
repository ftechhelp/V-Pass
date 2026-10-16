import { t } from '@nextcloud/l10n'
import type { ItemType } from '@vpass/core'
import type { Component } from 'vue'
import CardAccountDetailsIcon from 'vue-material-design-icons/CardAccountDetailsOutline.vue'
import CreditCardIcon from 'vue-material-design-icons/CreditCardOutline.vue'
import FingerprintIcon from 'vue-material-design-icons/Fingerprint.vue'
import KeyIcon from 'vue-material-design-icons/KeyVariant.vue'
import NoteIcon from 'vue-material-design-icons/NoteTextOutline.vue'
import StarIcon from 'vue-material-design-icons/StarOutline.vue'
import ViewGridIcon from 'vue-material-design-icons/ViewGridOutline.vue'
import type { Category } from '../stores/vault.ts'

export interface TypeInfo {
	type: ItemType
	label: string
	plural: string
	icon: Component
	color: string
}

export const ITEM_TYPE_INFO: Record<ItemType, TypeInfo> = {
	login: { type: 'login', label: t('vpass', 'Password'), plural: t('vpass', 'Passwords'), icon: KeyIcon, color: '#2f6fde' },
	note: { type: 'note', label: t('vpass', 'Secure note'), plural: t('vpass', 'Secure notes'), icon: NoteIcon, color: '#d08b00' },
	card: { type: 'card', label: t('vpass', 'Credit card'), plural: t('vpass', 'Credit cards'), icon: CreditCardIcon, color: '#14866d' },
	identity: { type: 'identity', label: t('vpass', 'Personal info'), plural: t('vpass', 'Personal info'), icon: CardAccountDetailsIcon, color: '#8e44ad' },
}

export interface CategoryInfo {
	id: Category
	label: string
	icon: Component
}

export const CATEGORIES: CategoryInfo[] = [
	{ id: 'all', label: t('vpass', 'All items'), icon: ViewGridIcon },
	{ id: 'login', label: t('vpass', 'Passwords'), icon: KeyIcon },
	{ id: 'passkey', label: t('vpass', 'Passkeys'), icon: FingerprintIcon },
	{ id: 'note', label: t('vpass', 'Secure notes'), icon: NoteIcon },
	{ id: 'card', label: t('vpass', 'Credit cards'), icon: CreditCardIcon },
	{ id: 'identity', label: t('vpass', 'Personal info'), icon: CardAccountDetailsIcon },
	{ id: 'favorites', label: t('vpass', 'Favorites'), icon: StarIcon },
]

export function categoryLabel(id: Category): string {
	return CATEGORIES.find((c) => c.id === id)?.label ?? id
}

/** Item type to pre-select when "New" is pressed inside a category. */
export function defaultTypeFor(category: Category | undefined): ItemType {
	return category === 'note' || category === 'card' || category === 'identity' ? category : 'login'
}
