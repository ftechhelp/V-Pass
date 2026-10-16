<template>
	<div ref="root" class="bar">
		<div v-if="view" class="stack">
			<div class="row">
				<ShieldLockIcon :size="22" class="brand" />
				<h3 class="grow" data-test="save-bar-title">{{ view.kind === 'new' ? 'Save this login in V-Pass?' : 'Update the saved password?' }}</h3>
				<button class="icon-btn" title="Not now" @click="respond('dismiss')"><CloseIcon :size="18" /></button>
			</div>
			<p class="muted small ellipsis">
				<template v-if="view.kind === 'update'">{{ view.itemTitle }} · </template>{{ view.username || 'No username' }} · {{ view.host }}
			</p>
			<div class="row">
				<button class="btn primary" :disabled="busy" data-test="save-bar-save" @click="respond('save')">
					<span v-if="busy" class="spinner" /> {{ view.kind === 'new' ? 'Save' : 'Update' }}
				</button>
				<button v-if="view.kind === 'new'" class="btn link" :disabled="busy" data-test="save-bar-never" @click="respond('never')">Never for this site</button>
			</div>
		</div>
		<p v-if="error" class="error-text small">{{ error }}</p>
	</div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import CloseIcon from 'vue-material-design-icons/Close.vue'
import ShieldLockIcon from 'vue-material-design-icons/ShieldLock.vue'
import type { SaveBarAction, SaveBarView } from '../../shared/protocol.ts'
import { send } from '../../shared/runtime.ts'
import { NOT_VISIBLE_MESSAGE, createVisibilityGuard } from '../ui/visibility.ts'

const token = location.hash.slice(1)
const root = ref<HTMLElement>()
let guard: ReturnType<typeof createVisibilityGuard> | null = null
const view = ref<SaveBarView | null>(null)
const busy = ref(false)
const error = ref('')

function reportHeight(): void {
	// The content's own height: documentElement.scrollHeight never drops below the iframe's.
	window.parent.postMessage({ vpass: 'height', height: root.value?.offsetHeight ?? 0 }, '*')
}

async function respond(action: SaveBarAction): Promise<void> {
	if (action !== 'dismiss' && !guard?.canInteract()) {
		error.value = NOT_VISIBLE_MESSAGE
		await nextTick()
		reportHeight()
		return
	}
	busy.value = true
	try {
		await send('saveBarRespond', { token, action })
		window.parent.postMessage({ vpass: 'close' }, '*')
	} catch (e) {
		error.value = (e as Error).message
		busy.value = false
		await nextTick()
		reportHeight()
	}
}

onMounted(async () => {
	guard = createVisibilityGuard(root.value!)
	new ResizeObserver(reportHeight).observe(root.value!)
	try {
		view.value = await send('saveBarData', { token })
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
.bar {
	padding: 14px 16px;
	border: 1px solid var(--border);
	border-radius: 10px;
	background: var(--bg);
}

.brand {
	color: var(--primary);
}
</style>
