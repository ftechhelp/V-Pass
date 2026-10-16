<template>
	<span class="item-icon" :class="`item-icon--${size}`" :style="{ backgroundColor: color }" aria-hidden="true">
		<span v-if="letter" class="item-icon__letter">{{ letter }}</span>
		<component :is="info.icon" v-else :size="size === 'large' ? 28 : 20" fill-color="#fff" />
	</span>
</template>

<script setup lang="ts">
import { type Item, hostnameOf, itemDisplayTitle } from '@vpass/core'
import { computed } from 'vue'
import { ITEM_TYPE_INFO } from '../utils/itemTypes.ts'

const props = withDefaults(defineProps<{
	item: Item
	size?: 'normal' | 'large'
}>(), { size: 'normal' })

const info = computed(() => ITEM_TYPE_INFO[props.item.type])

/** Logins get a letter avatar (like NordPass); other types show their type icon. */
const letter = computed(() => {
	if (props.item.type !== 'login') return ''
	const source = props.item.urls[0] ? hostnameOf(props.item.urls[0]) : itemDisplayTitle(props.item)
	return source.trim().charAt(0).toUpperCase()
})

const PALETTE = ['#2f6fde', '#14866d', '#c0392b', '#8e44ad', '#d08b00', '#16a085', '#2c3e50', '#d35400', '#7f8c8d', '#1f8dd6']

const color = computed(() => {
	if (!letter.value) return info.value.color
	const key = props.item.type === 'login' && props.item.urls[0] ? hostnameOf(props.item.urls[0]) : props.item.title
	let hash = 0
	for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0
	return PALETTE[Math.abs(hash) % PALETTE.length]
})
</script>

<style scoped lang="scss">
.item-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	width: 36px;
	height: 36px;
	border-radius: var(--border-radius-large, 10px);
	color: #fff;
	font-weight: 700;
	font-size: 16px;

	&--large {
		width: 56px;
		height: 56px;
		font-size: 24px;
		border-radius: var(--border-radius-container, 14px);
	}
}
</style>
