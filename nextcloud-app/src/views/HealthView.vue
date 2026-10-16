<template>
	<NcAppContent :page-heading="t('vpass', 'Password health')">
		<div class="page page--wide">
			<h2 class="page__title">
				{{ t('vpass', 'Password health') }}
			</h2>

			<NcLoadingIcon v-if="!report" :size="44" class="page__loading" />
			<template v-else>
				<div class="health__summary">
					<div class="health__score" :class="`health__score--${scoreLevel}`" role="img" :aria-label="t('vpass', 'Health score {score} out of 100', { score })">
						<span class="health__score-value">{{ score }}</span>
						<span class="health__score-label">{{ scoreText }}</span>
					</div>
					<div class="health__cards">
						<button v-for="card in cards"
							:key="card.id"
							class="health__card"
							:class="{ 'health__card--active': tab === card.id, 'health__card--bad': card.count > 0 }"
							type="button"
							@click="tab = card.id">
							<component :is="card.icon" :size="24" />
							<span class="health__card-count">{{ card.count }}</span>
							<span class="health__card-label">{{ card.label }}</span>
						</button>
					</div>
				</div>

				<NcNoteCard v-if="report.total === 0" type="info">
					{{ t('vpass', 'Add some passwords to see how healthy they are.') }}
				</NcNoteCard>

				<section v-if="tab === 'breached'" class="health__section">
					<p class="health__explain">
						{{ t('vpass', 'Checks your passwords against more than a billion passwords exposed in data breaches (Have I Been Pwned). Only the first 5 characters of each password\'s SHA-1 hash leave this device, so nobody learns your passwords.') }}
					</p>
					<NcNoteCard v-if="!config.hibpEnabled" type="warning">
						{{ t('vpass', 'Breach checks have been disabled by your administrator.') }}
					</NcNoteCard>
					<template v-else>
						<NcButton variant="primary" :disabled="scanning || report.total === 0" data-test="scan-breaches" @click="scan">
							<template #icon>
								<NcLoadingIcon v-if="scanning" :size="20" />
								<ShieldSearchIcon v-else :size="20" />
							</template>
							{{ scanning ? t('vpass', 'Checking {done} of {total}…', progress) : breached ? t('vpass', 'Check again') : t('vpass', 'Check for breached passwords') }}
						</NcButton>
						<NcNoteCard v-if="breached && breached.size === 0" type="success">
							{{ t('vpass', 'Good news: none of your passwords were found in known data breaches.') }}
						</NcNoteCard>
					</template>
				</section>
				<p v-else class="health__explain">
					{{ explanations[tab] }}
				</p>

				<ul v-if="listed.length" class="health__list">
					<NcListItem v-for="row in listed"
						:key="row.entry.id"
						:name="itemDisplayTitle(row.entry.item)"
						:to="{ name: 'category', params: { category: 'login', itemId: row.entry.id } }"
						one-line>
						<template #icon>
							<ItemIcon :item="row.entry.item" />
						</template>
						<template #subname>
							{{ row.detail }}
						</template>
					</NcListItem>
				</ul>
			</template>
		</div>
	</NcAppContent>
</template>

<script setup lang="ts">
import { showError } from '@nextcloud/dialogs'
import { loadState } from '@nextcloud/initial-state'
import { n, t } from '@nextcloud/l10n'
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcListItem from '@nextcloud/vue/components/NcListItem'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import { type HealthEntry, type HealthReport, analyzePasswords, checkBreaches, healthScore, itemDisplayTitle } from '@vpass/core'
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import AlertCircleIcon from 'vue-material-design-icons/AlertCircleOutline.vue'
import ClockIcon from 'vue-material-design-icons/ClockOutline.vue'
import ShieldAlertIcon from 'vue-material-design-icons/ShieldAlert.vue'
import ShieldSearchIcon from 'vue-material-design-icons/ShieldKey.vue'
import SyncIcon from 'vue-material-design-icons/Sync.vue'
import ItemIcon from '../components/ItemIcon.vue'
import { ensureStrengthEstimator, strengthScore } from '../composables/useStrength.ts'
import { api } from '../services/api.ts'
import { type VaultEntry, useVaultStore } from '../stores/vault.ts'

type Tab = 'weak' | 'reused' | 'old' | 'breached'

const store = useVaultStore()
const config = loadState<{ hibpEnabled: boolean }>('vpass', 'config', { hibpEnabled: true })
const report = shallowRef<HealthReport | null>(null)
const breached = shallowRef<Map<string, number> | null>(null)
const scanning = ref(false)
const progress = ref({ done: 0, total: 0 })
const tab = ref<Tab>('weak')

const logins = computed<HealthEntry[]>(() => store.active
	.filter((e): e is VaultEntry & { item: HealthEntry['item'] } => e.item.type === 'login')
	.map((e) => ({ id: e.id, item: e.item })))

async function analyze(): Promise<void> {
	await ensureStrengthEstimator()
	report.value = analyzePasswords(logins.value, { strength: strengthScore })
}

onMounted(analyze)
watch(logins, analyze)

const score = computed(() => (report.value
	? healthScore(report.value.total, [report.value.weak, report.value.reused.flat(), [...(breached.value?.keys() ?? [])]])
	: 0))
const scoreLevel = computed(() => (score.value >= 80 ? 'good' : score.value >= 50 ? 'fair' : 'bad'))
const scoreText = computed(() => ({ good: t('vpass', 'Healthy'), fair: t('vpass', 'Needs attention'), bad: t('vpass', 'At risk') })[scoreLevel.value])

const cards = computed(() => [
	{ id: 'weak' as const, label: t('vpass', 'Weak'), count: report.value?.weak.length ?? 0, icon: AlertCircleIcon },
	{ id: 'reused' as const, label: t('vpass', 'Reused'), count: report.value?.reused.flat().length ?? 0, icon: SyncIcon },
	{ id: 'old' as const, label: t('vpass', 'Old'), count: report.value?.old.length ?? 0, icon: ClockIcon },
	{ id: 'breached' as const, label: t('vpass', 'Breached'), count: breached.value?.size ?? 0, icon: ShieldAlertIcon },
])

const explanations: Record<Exclude<Tab, 'breached'>, string> = {
	weak: t('vpass', 'These passwords are easy to guess. Replace them with generated ones.'),
	reused: t('vpass', 'These passwords are used on more than one site. If one site leaks, the others are exposed too.'),
	old: t('vpass', 'These passwords have not been changed for over a year.'),
}

const listed = computed(() => {
	const r = report.value
	if (!r) return []
	const get = (id: string) => store.entries.get(id)
	const rows: { entry: VaultEntry, detail: string }[] = []
	if (tab.value === 'weak') {
		r.weak.forEach((id) => get(id) && rows.push({ entry: get(id)!, detail: get(id)!.item.type === 'login' ? (get(id)!.item as HealthEntry['item']).username : '' }))
	} else if (tab.value === 'reused') {
		r.reused.forEach((group) => group.forEach((id) => get(id) && rows.push({ entry: get(id)!, detail: n('vpass', 'Same password as %n other item', 'Same password as %n other items', group.length - 1) })))
	} else if (tab.value === 'old') {
		r.old.forEach((id) => get(id) && rows.push({ entry: get(id)!, detail: t('vpass', 'Unchanged for over a year') }))
	} else {
		breached.value?.forEach((count, id) => get(id) && rows.push({ entry: get(id)!, detail: n('vpass', 'Seen in %n breach', 'Seen %n times in breaches', count) }))
	}
	return rows
})

async function scan(): Promise<void> {
	scanning.value = true
	progress.value = { done: 0, total: 0 }
	try {
		breached.value = await checkBreaches(logins.value, (prefix) => api.breachRange(prefix), (done, total) => {
			progress.value = { done, total }
		})
	} catch (e) {
		showError(t('vpass', 'Breach check failed: {error}', { error: (e as Error).message }))
	} finally {
		scanning.value = false
	}
}
</script>

<style scoped lang="scss">
.health {
	&__summary {
		display: flex;
		gap: 24px;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 20px;
	}

	&__score {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 130px;
		height: 130px;
		border-radius: 50%;
		border: 10px solid var(--score-color);

		&--good { --score-color: var(--color-success); }
		&--fair { --score-color: var(--color-warning); }
		&--bad { --score-color: var(--color-error); }
	}

	&__score-value {
		font-size: 2.2em;
		font-weight: 700;
	}

	&__score-label {
		font-size: 0.85em;
		color: var(--color-text-maxcontrast);
	}

	&__cards {
		display: grid;
		grid-template-columns: repeat(4, minmax(100px, 1fr));
		gap: 10px;
		flex: 1;

		@media (max-width: 700px) {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	&__card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 14px 8px;
		border: 2px solid var(--color-border);
		border-radius: var(--border-radius-large);
		background: var(--color-main-background);
		color: var(--color-success-text, var(--color-main-text));
		cursor: pointer;

		&--bad {
			color: var(--color-error-text);
		}

		&--active {
			border-color: var(--color-primary-element);
			background: var(--color-primary-element-light);
		}
	}

	&__card-count {
		font-size: 1.6em;
		font-weight: 700;
	}

	&__card-label {
		color: var(--color-main-text);
	}

	&__section {
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: flex-start;
	}

	&__explain {
		color: var(--color-text-maxcontrast);
		margin-bottom: 10px;
	}

	&__list {
		margin-top: 12px;
	}
}
</style>
