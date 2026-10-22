<template>
	<svg class="totp-ring" viewBox="0 0 36 36" :aria-label="n('vpass', '%n second left', '%n seconds left', remaining)" role="img">
		<circle cx="18" cy="18" r="15" class="totp-ring__track" />
		<circle cx="18"
			cy="18"
			r="15"
			class="totp-ring__progress"
			:class="{ 'totp-ring__progress--low': remaining <= 5 }"
			:stroke-dasharray="`${(remaining / period) * 94.25} 94.25`" />
		<text x="18" y="22" text-anchor="middle">{{ remaining }}</text>
	</svg>
</template>

<script setup lang="ts">
import { n } from '@nextcloud/l10n'

/** Seconds left of a one-time code, as a ring that runs down and turns red at the end. */
defineProps<{ remaining: number, period: number }>()
</script>

<style scoped lang="scss">
.totp-ring {
	flex: none;
	width: 36px;
	height: 36px;
	transform: rotate(-90deg);

	text {
		transform: rotate(90deg);
		transform-origin: 18px 18px;
		font-size: 11px;
		fill: var(--color-main-text);
	}

	&__track {
		fill: none;
		stroke: var(--color-border);
		stroke-width: 3;
	}

	&__progress {
		fill: none;
		stroke: var(--color-primary-element);
		stroke-width: 3;
		stroke-linecap: round;
		transition: stroke-dasharray 0.9s linear;

		&--low {
			stroke: var(--color-error);
		}
	}
}
</style>
