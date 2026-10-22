<template>
	<NcAppContent :page-heading="t('vpass', '2FA codes')">
		<div class="page page--wide codes">
			<div class="codes__header">
				<h2 class="page__title">
					{{ t('vpass', '2FA codes') }}
				</h2>
				<NcButton :to="{ name: 'import' }" data-test="codes-import">
					<template #icon>
						<ImportIcon :size="20" />
					</template>
					{{ t('vpass', 'Import 2FA codes') }}
				</NcButton>
			</div>
			<p class="page__intro">
				{{ t('vpass', 'The one-time code of every login, like an authenticator app. Click a code to copy it.') }}
			</p>
			<NcTextField v-if="store.codes.length"
				v-model="query"
				class="codes__search"
				:label="t('vpass', 'Search codes')"
				:show-trailing-button="query !== ''"
				data-test="codes-search"
				@trailing-button-click="query = ''" />

			<ul v-if="entries.length" class="codes__list" data-test="codes-list">
				<li v-for="entry in entries" :key="entry.id" class="code" :data-test="`code-${entry.name}`">
					<button class="code__copy"
						:aria-label="t('vpass', 'Copy the code for {name}', { name: entry.name })"
						@click="copy(entry)">
						<span class="code__name">
							<span class="code__service">{{ entry.name }}</span>
							<span v-if="entry.account" class="code__account">{{ entry.account }}</span>
						</span>
						<span class="code__row">
							<span class="code__value" :class="{ 'code__value--low': lowOn(entry) }" data-test="code-value">
								{{ codes.get(entry.id) ? formatTotpCode(codes.get(entry.id)!.code) : '··· ···' }}
							</span>
							<TotpRing v-if="codes.get(entry.id)" :remaining="codes.get(entry.id)!.remaining" :period="codes.get(entry.id)!.period" />
						</span>
					</button>
					<NcButton class="code__open"
						variant="tertiary"
						:aria-label="t('vpass', 'Open the login')"
						:title="t('vpass', 'Open the login')"
						:to="{ name: 'category', params: { category: 'all', itemId: entry.id } }"
						data-test="code-open">
						<template #icon>
							<OpenInNewIcon :size="18" />
						</template>
					</NcButton>
				</li>
			</ul>
			<NcEmptyContent v-else-if="store.codes.length"
				:name="t('vpass', 'No codes match')"
				:description="t('vpass', 'Search by the service or the account name.')">
				<template #icon>
					<MagnifyIcon />
				</template>
			</NcEmptyContent>
			<NcEmptyContent v-else
				:name="t('vpass', 'No 2FA codes yet')"
				:description="t('vpass', 'Move your codes over from Google Authenticator or another authenticator app, or add one to a login by scanning the QR code a website shows when you turn on two-factor authentication.')"
				data-test="codes-empty">
				<template #icon>
					<TwoFactorIcon />
				</template>
				<template #action>
					<NcButton variant="primary" :to="{ name: 'import' }">
						{{ t('vpass', 'Import 2FA codes') }}
					</NcButton>
				</template>
			</NcEmptyContent>
		</div>
	</NcAppContent>
</template>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { type CodeEntry, type TotpCode, codeEntries, formatTotpCode, totpCode } from '@vpass/core'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import ImportIcon from 'vue-material-design-icons/Import.vue'
import MagnifyIcon from 'vue-material-design-icons/Magnify.vue'
import OpenInNewIcon from 'vue-material-design-icons/OpenInNew.vue'
import TwoFactorIcon from 'vue-material-design-icons/TwoFactorAuthentication.vue'
import TotpRing from '../components/TotpRing.vue'
import { copyToClipboard } from '../services/browser.ts'
import { useVaultStore } from '../stores/vault.ts'

const store = useVaultStore()
const query = ref('')
const entries = computed(() => query.value.trim() ? codeEntries(store.active, query.value) : store.codes)

/** The current code of each listed login, recomputed every second for the countdown. */
const codes = shallowRef(new Map<string, TotpCode>())

async function refresh(): Promise<void> {
	const now = Date.now()
	const list = entries.value
	const next = new Map<string, TotpCode>()
	await Promise.all(list.map(async (entry) => {
		next.set(entry.id, await totpCode(entry.totp, now))
	}))
	codes.value = next
}

watch(entries, refresh, { immediate: true })
const timer = setInterval(refresh, 1000)
onBeforeUnmount(() => clearInterval(timer))

const lowOn = (entry: CodeEntry) => (codes.value.get(entry.id)?.remaining ?? 30) <= 5

async function copy(entry: CodeEntry): Promise<void> {
	// Fresh, in case the code changed since the last tick.
	const { code } = await totpCode(entry.totp)
	await copyToClipboard(code, t('vpass', 'Code for {name}', { name: entry.name }))
}
</script>

<style scoped lang="scss">
.codes {
	&__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	&__search {
		max-width: 360px;
		margin-bottom: 16px;
	}

	&__list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 12px;
	}
}

.code {
	position: relative;
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large);

	&:hover {
		background: var(--color-background-hover);
	}

	&__copy {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 100%;
		margin: 0;
		padding: 12px 16px;
		border: 0;
		border-radius: inherit;
		background: none;
		text-align: start;
		cursor: pointer;
	}

	&__name {
		display: flex;
		flex-direction: column;
		min-width: 0;
		// Room for the "open the login" button in the corner.
		padding-inline-end: 36px;
	}

	&__service {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	&__account {
		font-size: 0.9em;
		color: var(--color-text-maxcontrast);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	&__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	&__value {
		font-family: var(--font-face-monospace, monospace);
		font-size: 2em;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--color-primary-element);

		&--low {
			color: var(--color-error-text);
		}
	}

	&__open {
		position: absolute;
		top: 6px;
		inset-inline-end: 6px;
	}
}
</style>
