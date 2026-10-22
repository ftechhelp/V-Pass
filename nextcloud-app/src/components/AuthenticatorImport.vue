<template>
	<div class="otp-import" data-test="otp-import">
		<!-- 1. collect codes -->
		<template v-if="stage === 'collect'">
			<p class="page__intro">
				{{ t('vpass', 'Move your one-time codes from Google Authenticator or another authenticator app into your logins. Everything is read on this device and only uploaded encrypted.') }}
			</p>
			<details class="otp-import__howto">
				<summary>{{ t('vpass', 'From Google Authenticator') }}</summary>
				<ol>
					<li>{{ t('vpass', 'In Google Authenticator, open the menu and choose "Transfer accounts", then "Export accounts".') }}</li>
					<li>{{ t('vpass', 'Select the accounts to move. Google Authenticator shows one QR code for about every 10 accounts.') }}</li>
					<li>{{ t('vpass', 'Scan each QR code with this computer\'s camera, or choose screenshots of them. Android does not allow screenshots of these codes, so use a camera there.') }}</li>
				</ol>
			</details>
			<details class="otp-import__howto">
				<summary>{{ t('vpass', 'From other apps') }}</summary>
				<ul>
					<li>{{ t('vpass', 'Aegis, 2FAS, Ente Auth and Bitwarden Authenticator: export your codes as an unencrypted file (without a password) and choose it here.') }}</li>
					<li>{{ t('vpass', 'Any other app that can show otpauth:// links: paste them below.') }}</li>
					<li>{{ t('vpass', 'Microsoft Authenticator cannot export its codes. Set up two-factor authentication again on each site and scan the new QR code in V-Pass.') }}</li>
				</ul>
			</details>

			<div class="otp-import__sources">
				<NcButton v-if="cameraSupported && !cameraOn" data-test="otp-camera" @click="startCamera">
					<template #icon>
						<CameraIcon :size="20" />
					</template>
					{{ t('vpass', 'Scan with camera') }}
				</NcButton>
				<NcButton v-else-if="cameraOn" data-test="otp-camera-stop" @click="stopCamera">
					<template #icon>
						<CameraOffIcon :size="20" />
					</template>
					{{ t('vpass', 'Stop camera') }}
				</NcButton>
				<NcButton data-test="otp-choose" @click="fileInput?.click()">
					<template #icon>
						<UploadIcon :size="20" />
					</template>
					{{ t('vpass', 'Choose screenshots or files') }}
				</NcButton>
				<input ref="fileInput"
					type="file"
					multiple
					accept="image/*,.json,.txt,.2fas,.csv,application/json,text/plain"
					class="hidden-visually"
					data-test="otp-files"
					@change="onFiles">
			</div>

			<video v-show="cameraOn" ref="video" class="otp-import__camera" data-test="otp-camera-view" />

			<div class="otp-import__paste">
				<NcTextArea v-model="pasted"
					:label="t('vpass', 'Or paste otpauth:// links or an export file')"
					resize="vertical"
					:rows="3"
					autocomplete="off"
					spellcheck="false"
					data-test="otp-paste" />
				<NcButton :disabled="!pasted.trim()" data-test="otp-paste-add" @click="addPasted">
					{{ t('vpass', 'Add') }}
				</NcButton>
			</div>

			<NcNoteCard v-if="message" :type="message.error ? 'error' : 'info'" data-test="otp-message">
				{{ message.text }}
			</NcNoteCard>
			<div class="otp-import__summary">
				<p data-test="otp-found">
					<strong>{{ n('vpass', '%n code found', '%n codes found', collected.entries.length) }}</strong>
					<template v-if="collected.progress">
						· {{ t('vpass', 'Google Authenticator QR code {scanned} of {total} scanned', collected.progress) }}
					</template>
				</p>
				<NcButton variant="primary" :disabled="!collected.entries.length && !collected.skipped.length" data-test="otp-review" @click="review">
					{{ t('vpass', 'Review') }}
				</NcButton>
			</div>
		</template>

		<!-- 2. review -->
		<div v-else-if="stage === 'review'" class="otp-import__review" data-test="otp-review-list">
			<ul class="otp-import__rows">
				<li v-for="row in rows" :key="row.entry.totp" :data-test="`otp-row-${row.entry.issuer || row.entry.account}`">
					<NcCheckboxRadioSwitch v-if="row.action !== 'exists'" v-model="row.selected">
						<span class="otp-import__name">{{ row.entry.issuer || row.entry.account || t('vpass', 'Unnamed code') }}</span>
						<span v-if="row.entry.issuer && row.entry.account" class="otp-import__muted"> · {{ row.entry.account }}</span>
						<span class="otp-import__where" :class="{ 'otp-import__where--warn': row.action === 'replace' }">{{ describe(row) }}</span>
					</NcCheckboxRadioSwitch>
					<div v-else class="otp-import__exists">
						<CheckIcon :size="20" />
						<span>
							<span class="otp-import__name">{{ row.entry.issuer || row.entry.account }}</span>
							<span class="otp-import__where">{{ describe(row) }}</span>
						</span>
					</div>
				</li>
			</ul>
			<NcNoteCard v-if="collected.skipped.length" type="warning">
				<p>{{ n('vpass', '%n code can\'t be imported:', '%n codes can\'t be imported:', collected.skipped.length) }}</p>
				<ul class="otp-import__skipped">
					<li v-for="(skip, i) in collected.skipped" :key="i">
						{{ [skip.issuer, skip.account].filter(Boolean).join(' · ') || t('vpass', 'Unnamed code') }}: {{ skip.reason }}
					</li>
				</ul>
			</NcNoteCard>
			<div class="otp-import__buttons">
				<NcButton @click="stage = 'collect'">
					{{ t('vpass', 'Back') }}
				</NcButton>
				<NcButton variant="primary" :disabled="!chosen.length" data-test="otp-confirm" @click="save">
					<template #icon>
						<ImportIcon :size="20" />
					</template>
					{{ n('vpass', 'Import %n code', 'Import %n codes', chosen.length) }}
				</NcButton>
			</div>
		</div>

		<!-- 3. saving -->
		<div v-else-if="stage === 'saving'" class="otp-import__review">
			<p>{{ t('vpass', 'Encrypting and saving… {done} of {total}', progress) }}</p>
			<NcProgressBar :value="progress.total ? Math.round(100 * progress.done / progress.total) : 0" size="medium" />
		</div>

		<!-- 4. done -->
		<div v-else class="otp-import__review" data-test="otp-done">
			<NcNoteCard type="success">
				{{ n('vpass', '%n code was imported.', '%n codes were imported.', imported) }}
			</NcNoteCard>
			<NcNoteCard type="warning">
				{{ t('vpass', 'Delete any screenshots or export files of your codes now: they are not encrypted. Keep the codes in your old app until you have signed in with a few of them from V-Pass.') }}
			</NcNoteCard>
			<div class="otp-import__buttons">
				<NcButton @click="reset">
					{{ t('vpass', 'Import more codes') }}
				</NcButton>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { showError } from '@nextcloud/dialogs'
import { n, t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcProgressBar from '@nextcloud/vue/components/NcProgressBar'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'
import {
	type AuthenticatorPlanRow,
	AuthenticatorImport,
	InvalidAuthenticatorExportError,
	NoQrCodeError,
	QrCamera,
	itemDisplayTitle,
	planAuthenticatorImport,
	readQrTextFromImage,
} from '@vpass/core'
import { computed, onBeforeUnmount, ref } from 'vue'
import CameraIcon from 'vue-material-design-icons/Camera.vue'
import CameraOffIcon from 'vue-material-design-icons/CameraOff.vue'
import CheckIcon from 'vue-material-design-icons/Check.vue'
import ImportIcon from 'vue-material-design-icons/Import.vue'
import UploadIcon from 'vue-material-design-icons/Upload.vue'
import { useVaultStore } from '../stores/vault.ts'

/**
 * Moving one-time codes from another authenticator app: Google Authenticator's
 * export QR codes (camera or screenshots), other apps' export files, or pasted
 * otpauth:// links. The parsing and the login matching are core's.
 */

const store = useVaultStore()

const stage = ref<'collect' | 'review' | 'saving' | 'done'>('collect')
const collected = ref(new AuthenticatorImport())
const rows = ref<AuthenticatorPlanRow[]>([])
const pasted = ref('')
const message = ref<{ text: string, error: boolean } | null>(null)
const fileInput = ref<HTMLInputElement>()
const video = ref<HTMLVideoElement>()
const cameraSupported = QrCamera.supported
const cameraOn = ref(false)
const progress = ref({ done: 0, total: 0 })
const imported = ref(0)
let camera: QrCamera | null = null

const chosen = computed(() => rows.value.filter((row) => row.selected && row.action !== 'exists'))

/** Add one QR code, file or paste; `source` names it in messages. */
function add(text: string, source: string): void {
	try {
		const result = collected.value.add(text)
		if (result.repeated) return
		const parts = [n('vpass', '%n new code', '%n new codes', result.added)]
		if (result.skipped) parts.push(n('vpass', '%n that can\'t be imported', '%n that can\'t be imported', result.skipped))
		message.value = { text: `${source}: ${parts.join(', ')}`, error: false }
	} catch (e) {
		message.value = { text: `${source}: ${e instanceof InvalidAuthenticatorExportError ? e.message : (e as Error).message}`, error: true }
	}
}

function addPasted(): void {
	add(pasted.value, t('vpass', 'Pasted text'))
	if (!message.value?.error) pasted.value = ''
}

async function onFiles(event: Event): Promise<void> {
	const input = event.target as HTMLInputElement
	const files = [...input.files ?? []]
	input.value = ''
	for (const file of files) {
		try {
			add(file.type.startsWith('image/') ? await readQrTextFromImage(file) : await file.text(), file.name)
		} catch (e) {
			message.value = {
				text: e instanceof NoQrCodeError
					? t('vpass', '{name}: no QR code found in this image', { name: file.name })
					: t('vpass', '{name} could not be read: {error}', { name: file.name, error: (e as Error).message }),
				error: true,
			}
		}
	}
}

async function startCamera(): Promise<void> {
	if (!video.value) return
	cameraOn.value = true
	message.value = { text: t('vpass', 'Hold each QR code in front of the camera until it is counted.'), error: false }
	camera = new QrCamera()
	try {
		await camera.start(video.value, (text) => add(text, t('vpass', 'Camera')))
	} catch (e) {
		stopCamera()
		const name = (e as Error).name
		message.value = {
			text: name === 'NotAllowedError'
				? t('vpass', 'The browser did not allow V-Pass to use the camera. Allow it in the site settings, or choose screenshots instead.')
				: name === 'NotFoundError'
					? t('vpass', 'This computer has no camera. Choose screenshots of the QR codes instead.')
					: t('vpass', 'The camera could not be started: {error}', { error: (e as Error).message }),
			error: true,
		}
	}
}

function stopCamera(): void {
	camera?.stop()
	camera = null
	cameraOn.value = false
	if (video.value) video.value.srcObject = null
}

function review(): void {
	stopCamera()
	rows.value = planAuthenticatorImport(collected.value.entries, store.active)
	stage.value = 'review'
}

function loginName(itemId: string | null): string {
	const entry = itemId ? store.entries.get(itemId) : undefined
	if (!entry) return ''
	const username = entry.item.type === 'login' ? entry.item.username : ''
	return username ? `${itemDisplayTitle(entry.item)} (${username})` : itemDisplayTitle(entry.item)
}

function describe(row: AuthenticatorPlanRow): string {
	switch (row.action) {
	case 'add': return t('vpass', 'Goes into {login}', { login: loginName(row.itemId) })
	case 'replace': return t('vpass', 'Replaces the different code in {login}', { login: loginName(row.itemId) })
	case 'exists': return t('vpass', 'Already in {login}', { login: loginName(row.itemId) })
	default: return t('vpass', 'New login')
	}
}

async function save(): Promise<void> {
	const selected = chosen.value
	stage.value = 'saving'
	progress.value = { done: 0, total: selected.length }
	try {
		imported.value = await store.importAuthenticatorCodes(selected, (done, total) => {
			progress.value = { done, total }
		})
		stage.value = 'done'
	} catch (e) {
		showError(t('vpass', 'Import stopped: {error}. Codes imported so far were kept.', { error: (e as Error).message }))
		review()
	}
}

function reset(): void {
	collected.value = new AuthenticatorImport()
	rows.value = []
	message.value = null
	stage.value = 'collect'
}

onBeforeUnmount(stopCamera)
</script>

<style scoped lang="scss">
.otp-import {
	display: flex;
	flex-direction: column;
	gap: 12px;

	&__howto {
		summary {
			cursor: pointer;
			color: var(--color-primary-element);
		}

		ol, ul {
			margin: 8px 0 0 20px;
		}

		ol {
			list-style: decimal;
		}

		ul {
			list-style: disc;
		}
	}

	&__sources, &__buttons, &__summary {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}

	&__buttons {
		justify-content: flex-end;
	}

	&__summary {
		justify-content: space-between;
	}

	&__camera {
		width: 100%;
		max-width: 480px;
		border-radius: var(--border-radius-large);
		background: #000;
	}

	&__paste {
		display: flex;
		gap: 8px;
		align-items: flex-end;

		> :first-child {
			flex: 1;
		}
	}

	&__review {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	&__rows li {
		padding: 2px 0;
		border-bottom: 1px solid var(--color-border);
	}

	&__name {
		font-weight: bold;
	}

	&__muted, &__where {
		color: var(--color-text-maxcontrast);
	}

	&__where {
		display: block;
		font-size: 0.9em;

		&--warn {
			color: var(--color-warning-text);
		}
	}

	&__exists {
		display: flex;
		gap: 10px;
		align-items: center;
		padding: 8px 10px;
		color: var(--color-success-text);
	}

	&__skipped {
		margin: 4px 0 0 16px;
		list-style: disc;
	}
}
</style>
