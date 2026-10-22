<template>
	<div class="import-page">
		<header class="logo"><ShieldLockIcon :size="28" class="brand" /> Import 2FA codes</header>

		<div v-if="!state" class="center"><span class="spinner" /></div>
		<p v-else-if="state.status === 'disconnected' || state.status === 'connecting'" class="note">
			Connect V-Pass to your Nextcloud first: click the V-Pass icon in Chrome's toolbar.
		</p>
		<p v-else-if="state.noVault" class="note">Create your vault in the V-Pass web app first, then come back here.</p>
		<section v-else-if="state.status === 'locked'" class="card">
			<UnlockForm :user="state.user" :server="state.server" :keep-unlocked="state.keepUnlocked" @unlocked="unlocked" />
		</section>

		<!-- 1. collect codes -->
		<section v-else-if="stage === 'collect'" class="card stack" data-test="otp-import">
			<p>
				Move your one-time codes from Google Authenticator or another authenticator app into your logins.
				Everything is read in this browser and only uploaded encrypted.
			</p>
			<details>
				<summary>From Google Authenticator</summary>
				<ol>
					<li>In Google Authenticator, open the menu and choose <b>Transfer accounts</b>, then <b>Export accounts</b>.</li>
					<li>Select the accounts to move. Google Authenticator shows one QR code for about every 10 accounts.</li>
					<li>Scan each QR code with this computer's camera, or choose screenshots of them. Android doesn't allow screenshots of these codes, so use a camera there.</li>
				</ol>
			</details>
			<details>
				<summary>From other apps</summary>
				<ul>
					<li>Aegis, 2FAS, Ente Auth and Bitwarden Authenticator: export your codes as an unencrypted file (without a password) and choose it here.</li>
					<li>Any other app that can show otpauth:// links: paste them below.</li>
					<li>Microsoft Authenticator can't export its codes. Set up two-factor authentication again on each site and scan the new QR code with V-Pass.</li>
				</ul>
			</details>

			<div class="row wrap">
				<button v-if="cameraSupported && !cameraOn" class="btn" data-test="otp-camera" @click="startCamera"><CameraIcon :size="18" /> Scan with camera</button>
				<button v-else-if="cameraOn" class="btn" data-test="otp-camera-stop" @click="stopCamera"><CameraOffIcon :size="18" /> Stop camera</button>
				<button class="btn" data-test="otp-choose" @click="fileInput?.click()"><UploadIcon :size="18" /> Choose screenshots or files</button>
				<input ref="fileInput"
					type="file"
					multiple
					accept="image/*,.json,.txt,.2fas,.csv,application/json,text/plain"
					hidden
					data-test="otp-files"
					@change="onFiles">
			</div>
			<video v-show="cameraOn" ref="video" class="camera" data-test="otp-camera-view" />

			<label class="field">
				<span>Or paste otpauth:// links or an export file</span>
				<textarea v-model="pasted" class="input mono" rows="3" autocomplete="off" spellcheck="false" data-test="otp-paste" />
			</label>
			<div>
				<button class="btn" :disabled="!pasted.trim()" data-test="otp-paste-add" @click="addPasted">Add</button>
			</div>

			<p v-if="message" class="note small" :class="{ error: message.error }" data-test="otp-message">{{ message.text }}</p>
			<div class="row">
				<p class="grow" data-test="otp-found">
					<b>{{ count(collected.entries.length, 'code') }} found</b>
					<template v-if="collected.progress"> · Google Authenticator QR code {{ collected.progress.scanned }} of {{ collected.progress.total }} scanned</template>
				</p>
				<button class="btn primary" :disabled="!collected.entries.length && !collected.skipped.length" data-test="otp-review" @click="review">Review</button>
			</div>
		</section>

		<!-- 2. review -->
		<section v-else-if="stage === 'review'" class="card stack" data-test="otp-review-list">
			<ul class="rows">
				<li v-for="row in rows" :key="row.entry.totp" :data-test="`otp-row-${row.entry.issuer || row.entry.account}`">
					<label v-if="row.action !== 'exists'" class="check">
						<input v-model="row.selected" type="checkbox">
						<span>
							<b>{{ row.entry.issuer || row.entry.account || 'Unnamed code' }}</b>
							<span v-if="row.entry.issuer && row.entry.account" class="muted"> · {{ row.entry.account }}</span>
							<span class="block small" :class="row.action === 'replace' ? 'warn' : 'muted'">{{ describe(row) }}</span>
						</span>
					</label>
					<div v-else class="check exists">
						<CheckIcon :size="18" />
						<span>
							<b>{{ row.entry.issuer || row.entry.account }}</b>
							<span class="block small muted">{{ describe(row) }}</span>
						</span>
					</div>
				</li>
			</ul>
			<div v-if="collected.skipped.length" class="note warning small">
				<p>{{ count(collected.skipped.length, 'code') }} can't be imported:</p>
				<ul>
					<li v-for="(skip, i) in collected.skipped" :key="i">{{ [skip.issuer, skip.account].filter(Boolean).join(' · ') || 'Unnamed code' }}: {{ skip.reason }}</li>
				</ul>
			</div>
			<p v-if="error" class="error-text">{{ error }}</p>
			<div class="row end">
				<button class="btn" :disabled="saving" @click="stage = 'collect'">Back</button>
				<button class="btn primary" :disabled="!chosen.length || saving" data-test="otp-confirm" @click="save">
					<span v-if="saving" class="spinner" />
					{{ saving ? `Saving… ${progress} of ${chosen.length}` : `Import ${count(chosen.length, 'code')}` }}
				</button>
			</div>
		</section>

		<!-- 3. done -->
		<section v-else class="card stack" data-test="otp-done">
			<p class="note">{{ count(imported, 'code') }} imported.</p>
			<p class="note warning">
				Delete any screenshots or export files of your codes now: they aren't encrypted. Keep the codes in your old app until you've signed in with a few of them from V-Pass.
			</p>
			<div><button class="btn" @click="reset">Import more codes</button></div>
		</section>
	</div>
</template>

<script setup lang="ts">
import {
	type AuthenticatorPlanRow,
	AuthenticatorImport,
	NoQrCodeError,
	QrCamera,
	itemDisplayTitle,
	planAuthenticatorImport,
	readQrTextFromImage,
} from '@vpass/core'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CameraIcon from 'vue-material-design-icons/Camera.vue'
import CameraOffIcon from 'vue-material-design-icons/CameraOff.vue'
import CheckIcon from 'vue-material-design-icons/Check.vue'
import ShieldLockIcon from 'vue-material-design-icons/ShieldLock.vue'
import UploadIcon from 'vue-material-design-icons/Upload.vue'
import type { ExtensionState, ItemView } from '../../shared/protocol.ts'
import { send } from '../../shared/runtime.ts'
import UnlockForm from '../ui/UnlockForm.vue'

/**
 * Moving one-time codes from another authenticator app, in a tab (the popup
 * closes too easily to hold a camera). Codes are read here with core and
 * stored by the background, which owns the vault key.
 */

const state = ref<ExtensionState | null>(null)
const stage = ref<'collect' | 'review' | 'done'>('collect')
const collected = ref(new AuthenticatorImport())
const rows = ref<AuthenticatorPlanRow[]>([])
const items = ref<ItemView[]>([])
const pasted = ref('')
const message = ref<{ text: string, error: boolean } | null>(null)
const error = ref('')
const fileInput = ref<HTMLInputElement>()
const video = ref<HTMLVideoElement>()
const cameraSupported = QrCamera.supported
const cameraOn = ref(false)
const saving = ref(false)
const progress = ref(0)
const imported = ref(0)
let camera: QrCamera | null = null

const chosen = computed(() => rows.value.filter((row) => row.selected && row.action !== 'exists'))
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

function unlocked(next: ExtensionState): void {
	state.value = next
}

/** Add one QR code, file or paste; `source` names it in messages. */
function add(text: string, source: string): void {
	try {
		const result = collected.value.add(text)
		if (result.repeated) return
		const parts = [`${count(result.added, 'new code')}`]
		if (result.skipped) parts.push(`${result.skipped} that can't be imported`)
		message.value = { text: `${source}: ${parts.join(', ')}`, error: false }
	} catch (e) {
		message.value = { text: `${source}: ${(e as Error).message}`, error: true }
	}
}

function addPasted(): void {
	add(pasted.value, 'Pasted text')
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
			message.value = { text: e instanceof NoQrCodeError ? `${file.name}: no QR code found in this image` : `${file.name} couldn't be read: ${(e as Error).message}`, error: true }
		}
	}
}

async function startCamera(): Promise<void> {
	if (!video.value) return
	cameraOn.value = true
	message.value = { text: 'Hold each QR code in front of the camera until it is counted.', error: false }
	camera = new QrCamera()
	try {
		await camera.start(video.value, (text) => add(text, 'Camera'))
	} catch (e) {
		stopCamera()
		const name = (e as Error).name
		message.value = {
			text: name === 'NotAllowedError'
				? 'Chrome didn\'t allow V-Pass to use the camera. Allow it with the camera icon in the address bar, or choose screenshots instead.'
				: name === 'NotFoundError'
					? 'This computer has no camera. Choose screenshots of the QR codes instead.'
					: `The camera couldn't be started: ${(e as Error).message}`,
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

async function review(): Promise<void> {
	stopCamera()
	error.value = ''
	// Match against the latest logins; offline, the cached copy does.
	await send('sync').catch(() => undefined)
	items.value = await send('items')
	rows.value = planAuthenticatorImport(collected.value.entries, items.value)
	stage.value = 'review'
}

function loginName(itemId: string | null): string {
	const entry = items.value.find((e) => e.id === itemId)
	if (!entry) return ''
	const username = entry.item.type === 'login' ? entry.item.username : ''
	return username ? `${itemDisplayTitle(entry.item)} (${username})` : itemDisplayTitle(entry.item)
}

function describe(row: AuthenticatorPlanRow): string {
	switch (row.action) {
	case 'add': return `Goes into ${loginName(row.itemId)}`
	case 'replace': return `Replaces the different code in ${loginName(row.itemId)}`
	case 'exists': return `Already in ${loginName(row.itemId)}`
	default: return 'New login'
	}
}

async function save(): Promise<void> {
	const codes = chosen.value.map((row) => ({ ...row.entry, itemId: row.itemId }))
	saving.value = true
	progress.value = 0
	error.value = ''
	try {
		// A few at a time, so the button can show how far it got.
		for (let i = 0; i < codes.length; i += 5) {
			progress.value += (await send('importTotp', { codes: codes.slice(i, i + 5) })).saved
		}
		imported.value = progress.value
		stage.value = 'done'
	} catch (e) {
		error.value = `Import stopped: ${(e as Error).message}. ${count(progress.value, 'code')} imported so far were kept.`
	} finally {
		saving.value = false
	}
}

function reset(): void {
	collected.value = new AuthenticatorImport()
	rows.value = []
	message.value = null
	stage.value = 'collect'
}

onMounted(async () => {
	state.value = await send('state')
})
onBeforeUnmount(stopCamera)
</script>

<style scoped>
.import-page {
	max-width: 640px;
	margin: 0 auto;
	padding: 32px 20px 60px;
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.brand {
	color: var(--primary);
}

.logo {
	font-size: 20px;
	margin-bottom: 8px;
}

.card {
	padding: 18px 20px;
	border: 1px solid var(--border);
	border-radius: 12px;
}

.center {
	display: flex;
	justify-content: center;
	padding: 40px;
}

details summary {
	cursor: pointer;
	color: var(--primary);
}

details ol, details ul, .note ul {
	margin: 6px 0 0 20px;
	padding: 0;
}

.wrap {
	flex-wrap: wrap;
}

.end {
	justify-content: flex-end;
}

.camera {
	width: 100%;
	max-width: 480px;
	border-radius: 12px;
	background: #000;
}

.mono {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	resize: vertical;
}

.rows {
	margin: 0;
	padding: 0;
	list-style: none;
}

.rows li {
	padding: 8px 0;
	border-bottom: 1px solid var(--border);
}

.block {
	display: block;
}

.warn {
	color: var(--warning-text);
}

.exists {
	color: var(--text-muted);
}
</style>
