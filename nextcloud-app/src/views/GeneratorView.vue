<template>
	<NcAppContent :page-heading="t('vpass', 'Password generator')">
		<div class="page">
			<h2 class="page__title">
				{{ t('vpass', 'Password generator') }}
			</h2>
			<p class="page__intro">
				{{ t('vpass', 'Generated on this device with a cryptographically secure random source. Nothing is sent anywhere.') }}
			</p>
			<GeneratorPanel />
		</div>
	</NcAppContent>
</template>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import GeneratorPanel from '../components/GeneratorPanel.vue'
</script>
