<template>
	<section v-if="model.length || editable" class="passkeys">
		<h3 class="passkeys__heading">
			{{ t('vpass', 'Passkeys') }}
		</h3>
		<ul v-if="model.length">
			<li v-for="(passkey, index) in model" :key="passkey.credentialId" class="passkeys__item">
				<FingerprintIcon :size="24" class="passkeys__icon" />
				<div class="passkeys__text">
					<div class="passkeys__name">
						{{ passkey.userName || passkey.userDisplayName || t('vpass', 'Passkey') }}
					</div>
					<div class="passkeys__meta">
						{{ passkey.rpName || passkey.rpId }} · {{ t('vpass', 'created {date}', { date: formatDate(passkey.createdAt) }) }}
					</div>
				</div>
				<NcButton v-if="editable"
					variant="tertiary"
					:aria-label="t('vpass', 'Remove passkey')"
					:title="t('vpass', 'Remove passkey')"
					@click="remove(index)">
					<template #icon>
						<DeleteIcon :size="20" />
					</template>
				</NcButton>
			</li>
		</ul>
		<p class="passkeys__hint">
			{{ model.length
				? t('vpass', 'Sign in to {site} with this passkey using the V-Pass browser extension.', { site: model[0]?.rpId ?? '' })
				: t('vpass', 'Passkeys are saved here automatically when you create one on a website with the V-Pass browser extension.') }}
		</p>
	</section>
</template>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import type { Passkey } from '@vpass/core'
import DeleteIcon from 'vue-material-design-icons/DeleteOutline.vue'
import FingerprintIcon from 'vue-material-design-icons/Fingerprint.vue'
import { confirmAction } from '../services/browser.ts'

defineProps<{ editable?: boolean }>()
const model = defineModel<Passkey[]>({ required: true })

function formatDate(iso: string): string {
	const date = new Date(iso)
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()
}

async function remove(index: number): Promise<void> {
	if (await confirmAction(t('vpass', 'Remove passkey?'), t('vpass', 'You will no longer be able to sign in with this passkey once you save.'), t('vpass', 'Remove'))) {
		model.value.splice(index, 1)
	}
}
</script>

<style scoped lang="scss">
.passkeys {
	padding: 0 12px;

	&__heading {
		font-size: 1em;
		font-weight: 600;
		margin: 16px 0 6px;
	}

	&__item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 0;
	}

	&__icon {
		color: var(--color-primary-element);
	}

	&__text {
		flex: 1;
		min-width: 0;
	}

	&__meta, &__hint {
		color: var(--color-text-maxcontrast);
		font-size: 0.9em;
	}
}
</style>
