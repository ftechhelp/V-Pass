<template>
	<span class="totp" :title="`Changes in ${view?.remaining ?? 0}s`">
		<span class="totp-code" data-test="totp-code">{{ view ? formatTotpCode(view.code) : '··· ···' }}</span>
		<svg v-if="view" class="totp-ring" viewBox="0 0 20 20" aria-hidden="true">
			<circle cx="10" cy="10" r="8" class="track" />
			<circle cx="10" cy="10" r="8" class="left" :style="{ strokeDashoffset: offset }" />
		</svg>
	</span>
</template>

<script setup lang="ts">
import { formatTotpCode } from '@vpass/core'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { TotpView } from '../../shared/protocol.ts'
import { send } from '../../shared/runtime.ts'

const props = defineProps<{ itemId: string }>()
const emit = defineEmits<{ code: [code: string] }>()

const view = ref<TotpView | null>(null)
const CIRCUMFERENCE = 2 * Math.PI * 8
const offset = computed(() => view.value ? CIRCUMFERENCE * (1 - view.value.remaining / view.value.period) : 0)
let timer: ReturnType<typeof setInterval> | undefined

async function refresh(): Promise<void> {
	try {
		view.value = await send('totp', { itemId: props.itemId })
		emit('code', view.value.code)
	} catch {
		view.value = null
	}
}

onMounted(() => {
	void refresh()
	timer = setInterval(() => {
		if (!view.value || view.value.remaining <= 1) {
			void refresh()
		} else {
			view.value = { ...view.value, remaining: view.value.remaining - 1 }
		}
	}, 1000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<style scoped>
.totp {
	display: inline-flex;
	align-items: center;
	gap: 8px;
}

.totp-code {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 16px;
	letter-spacing: 1px;
}

.totp-ring {
	width: 18px;
	height: 18px;
	transform: rotate(-90deg);
}

.totp-ring circle {
	fill: none;
	stroke-width: 3;
}

.totp-ring .track {
	stroke: var(--border);
}

.totp-ring .left {
	stroke: var(--primary);
	stroke-dasharray: 50.27;
	transition: stroke-dashoffset 1s linear;
}
</style>
