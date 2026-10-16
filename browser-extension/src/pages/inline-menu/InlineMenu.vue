<template>
	<div ref="root" class="menu" @keydown="onKey">
		<div v-if="!view" class="loading"><span class="spinner" /></div>
		<template v-else>
			<button v-if="view.locked" class="list-item" data-test="inline-unlock" @click="choose({ kind: 'unlock' })">
				<span class="avatar"><LockIcon :size="18" /></span>
				<span class="grow"><span class="title">Unlock V-Pass</span><span class="muted small">to fill this field</span></span>
			</button>
			<template v-else>
				<button v-for="p in view.passkeys" :key="`pk-${p.id}-${p.credentialId}`" class="list-item" data-test="inline-passkey"
					@click="choose({ kind: 'passkey', id: p.id, credentialId: p.credentialId })">
					<span class="avatar"><FingerprintIcon :size="18" /></span>
					<span class="grow"><span class="title ellipsis">{{ p.subtitle || p.title }}</span><span class="muted small ellipsis">Passkey · {{ p.title }}</span></span>
				</button>
				<button v-for="l in view.logins" :key="`l-${l.id}`" class="list-item" data-test="inline-login" @click="choose({ kind: 'login', id: l.id })">
					<span class="avatar">{{ l.title.trim()[0] ?? '?' }}</span>
					<span class="grow"><span class="title ellipsis">{{ l.title }}</span><span class="muted small ellipsis">{{ view.fieldKind === 'totp' ? 'Fill one-time code' : l.subtitle || 'No username' }}</span></span>
				</button>
				<button v-for="c in view.cards" :key="`c-${c.id}`" class="list-item" data-test="inline-card" @click="choose({ kind: 'card', id: c.id })">
					<span class="avatar"><CreditCardIcon :size="18" /></span>
					<span class="grow"><span class="title ellipsis">{{ c.title }}</span><span class="muted small ellipsis">{{ c.subtitle }}</span></span>
				</button>
				<button v-for="i in view.identities" :key="`i-${i.id}`" class="list-item" data-test="inline-identity" @click="choose({ kind: 'identity', id: i.id })">
					<span class="avatar"><CardAccountDetailsIcon :size="18" /></span>
					<span class="grow"><span class="title ellipsis">{{ i.title }}</span><span class="muted small ellipsis">{{ i.subtitle }}</span></span>
				</button>
				<button v-if="view.canGenerate" class="list-item" data-test="inline-generate" @click="choose({ kind: 'generate' })">
					<span class="avatar"><Dice5Icon :size="18" /></span>
					<span class="grow"><span class="title">Generate password</span><span class="muted small">Strong and saved when you submit</span></span>
				</button>
				<p v-if="empty" class="muted small empty">Nothing saved for {{ view.host }} yet.</p>
			</template>
		</template>
		<p v-if="error" class="error-text small empty">{{ error }}</p>
	</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import CardAccountDetailsIcon from 'vue-material-design-icons/CardAccountDetails.vue'
import CreditCardIcon from 'vue-material-design-icons/CreditCard.vue'
import Dice5Icon from 'vue-material-design-icons/Dice5.vue'
import FingerprintIcon from 'vue-material-design-icons/Fingerprint.vue'
import LockIcon from 'vue-material-design-icons/Lock.vue'
import type { InlineChoice, InlineView } from '../../shared/protocol.ts'
import { send } from '../../shared/runtime.ts'
import { NOT_VISIBLE_MESSAGE, createVisibilityGuard } from '../ui/visibility.ts'

const token = location.hash.slice(1)
const root = ref<HTMLElement>()
const view = ref<InlineView | null>(null)
const error = ref('')
let guard: ReturnType<typeof createVisibilityGuard> | null = null
const empty = computed(() => !!view.value && !view.value.passkeys.length && !view.value.logins.length
	&& !view.value.cards.length && !view.value.identities.length && !view.value.canGenerate)

/** Tell the page-side frame how tall we are (only a number crosses into the page). */
function reportHeight(): void {
	// The content's own height: documentElement.scrollHeight never drops below the iframe's.
	window.parent.postMessage({ vpass: 'height', height: root.value?.offsetHeight ?? 0 }, '*')
}

function close(): void {
	window.parent.postMessage({ vpass: 'close' }, '*')
}

async function choose(choice: InlineChoice): Promise<void> {
	if (!guard?.canInteract()) {
		error.value = NOT_VISIBLE_MESSAGE
		await nextTick()
		reportHeight()
		return
	}
	try {
		await send('inlineChoose', { token, choice })
		if (choice.kind === 'unlock') close()
	} catch (e) {
		error.value = (e as Error).message
		await nextTick()
		reportHeight()
	}
}

function items(): HTMLElement[] {
	return [...(root.value?.querySelectorAll<HTMLElement>('.list-item') ?? [])]
}

function onKey(event: KeyboardEvent): void {
	const list = items()
	const index = list.indexOf(document.activeElement as HTMLElement)
	if (event.key === 'ArrowDown') {
		list[Math.min(index + 1, list.length - 1)]?.focus()
	} else if (event.key === 'ArrowUp') {
		if (index <= 0) close()
		else list[index - 1]?.focus()
	} else if (event.key === 'Escape') {
		close()
	} else {
		return
	}
	event.preventDefault()
}

window.addEventListener('message', (event) => {
	if (event.source === window.parent && (event.data as { vpass?: string } | null)?.vpass === 'focus') {
		items()[0]?.focus()
	}
})

onMounted(async () => {
	new ResizeObserver(reportHeight).observe(root.value!)
	guard = createVisibilityGuard(root.value!)
	try {
		view.value = await send('inlineData', { token })
	} catch (e) {
		error.value = (e as Error).message
	}
	await nextTick()
	reportHeight()
})
</script>

<style>
html, body {
	background: transparent;
	overflow: hidden;
}
</style>

<style scoped>
.menu {
	display: flex;
	flex-direction: column;
	padding: 4px;
	border: 1px solid var(--border);
	border-radius: 10px;
	background: var(--bg);
}

.loading {
	display: flex;
	justify-content: center;
	padding: 12px;
}

.list-item {
	min-height: 44px;
}

.title {
	display: block;
	font-weight: 500;
}

.grow > span {
	display: block;
}

.empty {
	padding: 10px 12px;
}
</style>
