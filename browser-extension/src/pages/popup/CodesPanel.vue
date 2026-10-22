<template>
	<div class="codes">
		<template v-if="all.length">
			<div class="search">
				<MagnifyIcon :size="18" class="muted" />
				<input v-model="query" class="search-input" placeholder="Search codes" data-test="codes-search" autofocus>
			</div>
			<ul v-if="entries.length" class="list codes-list" data-test="codes-list">
				<li v-for="entry in entries" :key="entry.id" :data-test="`code-${entry.name}`">
					<div class="list-item code" role="button" tabindex="0" :title="`Copy the code for ${entry.name}`" @click="copyCode(entry)" @keydown.enter="copyCode(entry)">
						<span class="grow">
							<span class="ellipsis small name">{{ entry.name }}<span v-if="entry.account" class="muted"> · {{ entry.account }}</span></span>
							<span class="value" :class="{ low: (codes.get(entry.id)?.remaining ?? 30) <= 5 }" data-test="code-value">
								{{ codes.get(entry.id) ? formatTotpCode(codes.get(entry.id)!.code) : '··· ···' }}
							</span>
						</span>
						<CheckIcon v-if="copied === entry.id" :size="20" class="copied" data-test="code-copied" />
						<svg v-else-if="codes.get(entry.id)" class="ring" viewBox="0 0 20 20" :aria-label="`${codes.get(entry.id)!.remaining} seconds left`">
							<circle cx="10" cy="10" r="8" class="track" />
							<circle cx="10" cy="10" r="8" class="left" :class="{ low: codes.get(entry.id)!.remaining <= 5 }" :style="{ strokeDashoffset: offset(codes.get(entry.id)!) }" />
						</svg>
						<button class="icon-btn" title="Details" data-test="code-open" @click.stop="emit('open', entry.id)"><DotsVerticalIcon :size="18" /></button>
					</div>
				</li>
			</ul>
			<p v-else class="empty muted">No codes match.</p>
		</template>
		<div v-else class="empty" data-test="codes-empty">
			<p class="muted">No 2FA codes yet. Move them over from Google Authenticator or another authenticator app, or scan the QR code a site shows when you turn on two-factor authentication.</p>
			<button class="btn primary" data-test="codes-import" @click="send('openImport')">Import 2FA codes</button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { type CodeEntry, type TotpCode, codeEntries, formatTotpCode, totpCode } from '@vpass/core'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import CheckIcon from 'vue-material-design-icons/Check.vue'
import DotsVerticalIcon from 'vue-material-design-icons/DotsVertical.vue'
import MagnifyIcon from 'vue-material-design-icons/Magnify.vue'
import type { ItemView } from '../../shared/protocol.ts'
import { send } from '../../shared/runtime.ts'
import { useCopy } from '../ui/copy.ts'

/** Every login's one-time code, like an authenticator app: click to copy. */
const props = defineProps<{ items: ItemView[] }>()
const emit = defineEmits<{ open: [itemId: string] }>()

const query = ref('')
const all = computed(() => codeEntries(props.items))
const entries = computed(() => query.value.trim() ? codeEntries(props.items, query.value) : all.value)
const { copied, copy } = useCopy()

/** The current code of each listed login, recomputed every second for the countdown. */
const codes = shallowRef(new Map<string, TotpCode>())
const CIRCUMFERENCE = 2 * Math.PI * 8
const offset = (code: TotpCode) => CIRCUMFERENCE * (1 - code.remaining / code.period)

async function refresh(): Promise<void> {
	const now = Date.now()
	const next = new Map<string, TotpCode>()
	await Promise.all(entries.value.map(async (entry) => {
		next.set(entry.id, await totpCode(entry.totp, now))
	}))
	codes.value = next
}

watch(entries, refresh, { immediate: true })
const timer = setInterval(refresh, 1000)
onBeforeUnmount(() => clearInterval(timer))

async function copyCode(entry: CodeEntry): Promise<void> {
	const { code } = await totpCode(entry.totp)
	await copy(code, entry.id)
}
</script>

<style scoped>
.search {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 0 10px;
	border: 1px solid var(--border);
	border-radius: var(--radius);
}

.search-input {
	flex: 1;
	min-height: 34px;
	border: 0;
	outline: none;
	background: none;
}

.codes-list {
	margin-top: 8px;
}

.name, .value {
	display: block;
}

.code {
	padding-block: 8px;
}

.name {
	color: var(--text);
}

.value {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 24px;
	font-weight: 600;
	letter-spacing: 1px;
	color: var(--primary);
}

.value.low {
	color: var(--danger);
}

.copied {
	color: var(--primary);
}

.ring {
	flex: none;
	width: 20px;
	height: 20px;
	transform: rotate(-90deg);
}

.ring circle {
	fill: none;
	stroke-width: 3;
}

.ring .track {
	stroke: var(--border);
}

.ring .left {
	stroke: var(--primary);
	stroke-dasharray: 50.27;
	transition: stroke-dashoffset 1s linear;
}

.ring .left.low {
	stroke: var(--danger);
}

.empty .btn {
	margin-top: 12px;
}
</style>
