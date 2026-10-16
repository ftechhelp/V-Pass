<template>
	<NcAppContent :page-heading="t('vpass', 'Browser extension')">
		<div class="page extension">
			<h2 class="page__title">
				{{ t('vpass', 'Browser extension') }}
			</h2>
			<p class="page__intro">
				{{ t('vpass', 'Fill passwords, one-time codes, cards and addresses on websites, save new logins as you sign in, and use the passkeys stored in V-Pass. Like this page, the extension decrypts your vault only on your device.') }}
			</p>

			<NcNoteCard v-if="!chromium" type="info">
				{{ t('vpass', 'The V-Pass extension runs in Chrome, Edge, Brave and other Chromium-based browsers. Open this page in one of them to install it.') }}
			</NcNoteCard>

			<!-- Status in this browser -->
			<section v-else class="extension__section" data-test="extension-status">
				<h3>{{ t('vpass', 'In this browser') }}</h3>
				<p v-if="status === undefined" class="extension__row">
					<NcLoadingIcon :size="20" /> {{ t('vpass', 'Looking for the extension…') }}
				</p>
				<template v-else-if="status === null">
					<p data-test="extension-missing">
						{{ t('vpass', 'The V-Pass extension is not installed in this browser.') }}
					</p>
					<template v-if="storeUrl">
						<NcButton variant="primary" :href="storeUrl" target="_blank" rel="noopener noreferrer" data-test="extension-store">
							<template #icon>
								<GoogleChromeIcon :size="20" />
							</template>
							{{ t('vpass', 'Add to Chrome') }}
						</NcButton>
						<p class="extension__muted">
							{{ t('vpass', 'After adding it, come back to this page to connect it to your vault.') }}
						</p>
						<NcButton v-if="!manualOpen" variant="tertiary" @click="manualOpen = true">
							{{ t('vpass', 'Install it by hand instead') }}
						</NcButton>
					</template>
					<p v-else class="extension__muted">
						{{ t('vpass', 'V-Pass is not in the Chrome Web Store yet, so install it by hand below. It takes about a minute.') }}
					</p>
				</template>
				<NcNoteCard v-else-if="status.thisServer" type="success" data-test="extension-connected">
					{{ t('vpass', 'V-Pass {version} is installed and connected to this Nextcloud.', { version: status.version }) }}
					<template v-if="status.locked">
						{{ t('vpass', 'Unlock it with the V-Pass icon in the toolbar to start filling.') }}
					</template>
				</NcNoteCard>
				<NcNoteCard v-else-if="status.connected" type="warning" data-test="extension-other-server">
					{{ t('vpass', 'V-Pass {version} is connected to a different Nextcloud. To use this one, open the extension\'s settings, choose Disconnect, then come back here.', { version: status.version }) }}
				</NcNoteCard>
				<template v-else>
					<p data-test="extension-not-connected">
						{{ status.connecting
							? t('vpass', 'Finish signing in on the Nextcloud page that V-Pass opened, then choose "Grant access".')
							: t('vpass', 'V-Pass {version} is installed in this browser but not connected to your vault yet.', { version: status.version }) }}
					</p>
					<NcButton v-if="!status.connecting" variant="primary" :disabled="busy" data-test="extension-connect" @click="connect">
						<template #icon>
							<NcLoadingIcon v-if="busy" :size="20" />
							<LinkVariantIcon v-else :size="20" />
						</template>
						{{ t('vpass', 'Connect this browser') }}
					</NcButton>
				</template>
				<p v-if="hint" class="extension__muted" data-test="extension-hint">
					{{ hint }}
				</p>
				<NcNoteCard v-if="updateAvailable" type="info" data-test="extension-update">
					{{ t('vpass', 'Version {next} is available (you have {current}). Download it below, replace the files in your V-Pass folder, then click the reload icon on V-Pass in chrome://extensions.', { next: bundledVersion ?? '', current: status?.version ?? '' }) }}
				</NcNoteCard>
			</section>

			<!-- Manual ("load unpacked") install -->
			<section v-if="showManual" class="extension__section" data-test="extension-manual">
				<h3>{{ storeUrl ? t('vpass', 'Install by hand') : t('vpass', 'Install') }}</h3>
				<ol class="extension__steps">
					<li>
						<NcButton v-if="bundledVersion" :href="downloadUrl" :download="`vpass-extension-${bundledVersion}.zip`" data-test="extension-download">
							<template #icon>
								<DownloadIcon :size="20" />
							</template>
							{{ t('vpass', 'Download V-Pass {version}', { version: bundledVersion }) }}
						</NcButton>
						<span v-else>{{ t('vpass', 'This server has no extension package. Ask your administrator to install V-Pass from a release package.') }}</span>
					</li>
					<li>{{ t('vpass', 'Unzip it into a folder you will keep, for example "Documents/V-Pass extension". Chrome runs the extension from there.') }}</li>
					<li>
						{{ t('vpass', 'Open a new tab, go to chrome://extensions and turn on Developer mode (top right).') }}
						<NcButton variant="tertiary" @click="copyExtensionsAddress">
							<template #icon>
								<ContentCopyIcon :size="20" />
							</template>
							{{ t('vpass', 'Copy address') }}
						</NcButton>
					</li>
					<li>{{ t('vpass', 'Click "Load unpacked" and choose the folder.') }}</li>
					<li>{{ t('vpass', 'Come back to this page and click "Connect this browser".') }}</li>
				</ol>
			</section>
		</div>
	</NcAppContent>
</template>

<script setup lang="ts">
import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ContentCopyIcon from 'vue-material-design-icons/ContentCopy.vue'
import DownloadIcon from 'vue-material-design-icons/Download.vue'
import GoogleChromeIcon from 'vue-material-design-icons/GoogleChrome.vue'
import LinkVariantIcon from 'vue-material-design-icons/LinkVariant.vue'
import {
	type ExtensionStatus,
	CHROME_WEB_STORE_URL,
	bundledExtensionVersion,
	compareVersions,
	connectExtension,
	extensionDownloadUrl,
	extensionStatus,
	isChromium,
} from '../services/extension.ts'

const chromium = isChromium()
const storeUrl = CHROME_WEB_STORE_URL
const bundledVersion = bundledExtensionVersion
const downloadUrl = extensionDownloadUrl

/** undefined: still looking; null: not installed. */
const status = ref<ExtensionStatus | null | undefined>(undefined)
const manualOpen = ref(false)
const busy = ref(false)
const hint = ref('')

// With the Chrome Web Store, Chrome updates the extension by itself.
const updateAvailable = computed(() => !storeUrl && !!status.value && !!bundledVersion && compareVersions(bundledVersion, status.value.version) > 0)
const showManual = computed(() => chromium && ((status.value === null && (!storeUrl || manualOpen.value)) || updateAvailable.value))

async function refresh(): Promise<void> {
	status.value = await extensionStatus()
	if (status.value?.thisServer) {
		hint.value = ''
	}
}

async function connect(): Promise<void> {
	busy.value = true
	hint.value = ''
	try {
		switch (await connectExtension()) {
		case 'confirm':
			hint.value = t('vpass', 'Confirm in the V-Pass window that just opened, then choose "Grant access" on the Nextcloud page.')
			break
		case 'connecting':
			hint.value = t('vpass', 'Finish signing in on the Nextcloud page that V-Pass opened.')
			break
		case null:
			hint.value = t('vpass', 'The extension did not answer. Reload this page and try again.')
			break
		default:
			break
		}
		await refresh()
	} finally {
		busy.value = false
	}
}

async function copyExtensionsAddress(): Promise<void> {
	try {
		await navigator.clipboard.writeText('chrome://extensions')
		showSuccess(t('vpass', 'Copied. Paste it into a new tab.'))
	} catch {
		showError(t('vpass', 'Could not copy. Type chrome://extensions into a new tab.'))
	}
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
	if (!chromium) return
	void refresh()
	// Notice an install, a finished sign-in or an unlock without a reload.
	timer = setInterval(() => void refresh(), 3000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<style scoped lang="scss">
.extension {
	&__section {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
		padding: 18px 0;
		border-bottom: 1px solid var(--color-border);

		h3 {
			margin: 0;
			font-size: 1.15em;
		}

		p {
			margin: 0;
		}
	}

	&__row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	&__muted {
		color: var(--color-text-maxcontrast);
	}

	&__steps {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 0;
		padding-inline-start: 20px;
		list-style: decimal;

		li > .button-vue {
			margin-top: 6px;
		}
	}
}
</style>
