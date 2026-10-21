// Chrome Web Store API v2 for the V-Pass listing: upload a tested package and
// submit it for review. .github/workflows/extension.yml runs it on main; it also
// works by hand (Node 24+ runs this file directly):
//
//   node browser-extension/scripts/web-store.ts status          what the store has (published, in review)
//   node browser-extension/scripts/web-store.ts release <zip>   upload the zip and submit it for review,
//                                                               unless the store already has that version
//
// It signs in as a Google Cloud service account added to the publisher
// (browser-extension/store/LISTING.md, "Automatic uploads"):
//   CWS_SERVICE_ACCOUNT_KEY   the service account's JSON key (the file's contents)
//   CWS_PUBLISHER_ID          Developer Dashboard → Publisher → Settings
import { strFromU8, unzipSync } from 'fflate'
import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const EXTENSION_ID = 'fnbnjjalcjpopkiobdkaaffdiccolbfl'
const API = 'https://chromewebstore.googleapis.com'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore'

export interface ServiceAccountKey {
	client_email: string
	private_key: string
}

/** PENDING_REVIEW, STAGED, PUBLISHED, PUBLISHED_TO_TESTERS, REJECTED or CANCELLED. */
interface RevisionStatus {
	state: string
	distributionChannels?: { crxVersion: string, deployPercentage?: number }[]
}

export interface ItemStatus {
	publishedItemRevisionStatus?: RevisionStatus
	submittedItemRevisionStatus?: RevisionStatus
	lastAsyncUploadState?: string
}

export interface Store {
	token: string
	/** publishers/<publisher id>/items/<extension id> */
	item: string
}

const base64url = (data: string | Uint8Array) => Buffer.from(data).toString('base64url')

/** OAuth 2.0 for a service account: a JWT signed with its key, traded for an access token. */
export async function accessToken(key: ServiceAccountKey, now = Date.now()): Promise<string> {
	const iat = Math.floor(now / 1000)
	const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
	const claims = base64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 600 }))
	let signature: string
	try {
		signature = base64url(createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.private_key))
	} catch (e) {
		throw new Error(`The service account key can't sign (${(e as Error).message}). CWS_SERVICE_ACCOUNT_KEY must be the whole JSON key file.`)
	}
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }),
	})
	const body = await response.json().catch(() => ({})) as { access_token?: string }
	if (!response.ok || !body.access_token) {
		throw new Error(`Google sign-in failed (HTTP ${response.status}): ${JSON.stringify(body)}`)
	}
	return body.access_token
}

async function call<T>(store: Store, method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}): Promise<T> {
	const response = await fetch(`${API}${path}`, { method, body, headers: { Authorization: `Bearer ${store.token}`, ...headers } })
	const text = await response.text()
	if (!response.ok) {
		throw new Error(`${method} ${path}: HTTP ${response.status}\n${text}`)
	}
	return (text ? JSON.parse(text) : {}) as T
}

export const fetchStatus = (store: Store) => call<ItemStatus>(store, 'GET', `/v2/${store.item}:fetchStatus`)

/** Dotted versions, compared numerically ("0.10.0" is newer than "0.9.1"). */
export function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map(Number)
	const pb = b.split('.').map(Number)
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
		if (diff) return Math.sign(diff)
	}
	return 0
}

const versionsOf = (revision?: RevisionStatus) => (revision?.distributionChannels ?? []).map((c) => c.crxVersion)

export type ReleasePlan = { upload: false, reason: string } | { upload: true, cancelPending: boolean }

/**
 * Upload only versions newer than what the store has, so re-runs do nothing. An
 * older version still waiting for review is cancelled: the store reviews one
 * submission at a time, and the newer one replaces it.
 */
export function planRelease(version: string, status: ItemStatus): ReleasePlan {
	for (const published of versionsOf(status.publishedItemRevisionStatus)) {
		if (compareVersions(version, published) <= 0) {
			return { upload: false, reason: `The store already publishes ${published}` }
		}
	}
	const submitted = status.submittedItemRevisionStatus
	for (const pending of versionsOf(submitted)) {
		if (compareVersions(version, pending) <= 0) {
			return { upload: false, reason: `${pending} is already submitted (${submitted?.state})` }
		}
	}
	return { upload: true, cancelPending: submitted?.state === 'PENDING_REVIEW' }
}

export function manifestVersion(zip: Uint8Array): string {
	const manifest = unzipSync(zip, { filter: (file) => file.name === 'manifest.json' })['manifest.json']
	if (!manifest) {
		throw new Error('The package has no manifest.json')
	}
	return (JSON.parse(strFromU8(manifest)) as { version: string }).version
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function release(store: Store, zip: Uint8Array, log: (line: string) => void = console.log, wait = sleep): Promise<void> {
	const version = manifestVersion(zip)
	const plan = planRelease(version, await fetchStatus(store))
	if (!plan.upload) {
		log(`${plan.reason}; nothing to upload for ${version}.`)
		return
	}
	if (plan.cancelPending) {
		log('Cancelling the review of the older version that is still pending, so this one replaces it.')
		await call(store, 'POST', `/v2/${store.item}:cancelSubmission`)
	}
	log(`Uploading ${version}…`)
	const upload = await call<{ uploadState?: string }>(store, 'POST', `/upload/v2/${store.item}:upload`, new Blob([zip as Uint8Array<ArrayBuffer>]))
	let state = upload.uploadState ?? 'UPLOAD_STATE_UNSPECIFIED'
	// Large packages are processed asynchronously (IN_PROGRESS; the guide says UPLOAD_IN_PROGRESS).
	for (let i = 0; i < 60 && state.endsWith('IN_PROGRESS'); i++) {
		await wait(5000)
		state = (await fetchStatus(store)).lastAsyncUploadState ?? state
	}
	if (state !== 'SUCCEEDED') {
		throw new Error(`The upload of ${version} did not succeed (${state}): ${JSON.stringify(upload)}`)
	}
	log(`Submitting ${version} for review…`)
	const submitted = await call<{ state?: string, warningInfo?: unknown }>(store, 'POST', `/v2/${store.item}:publish`,
		JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }), { 'Content-Type': 'application/json' })
	log(`Submitted (${submitted.state}). It goes live, with the listing's current visibility, once the review passes.`)
	if (submitted.warningInfo) {
		log(`Warnings: ${JSON.stringify(submitted.warningInfo)}`)
	}
}

async function main(): Promise<void> {
	const [command, file] = process.argv.slice(2)
	if (command !== 'status' && !(command === 'release' && file)) {
		throw new Error('Usage: node browser-extension/scripts/web-store.ts status | release <zip>')
	}
	const key = process.env.CWS_SERVICE_ACCOUNT_KEY
	const publisher = process.env.CWS_PUBLISHER_ID
	if (!key || !publisher) {
		throw new Error('Set CWS_SERVICE_ACCOUNT_KEY (the service account\'s JSON key) and CWS_PUBLISHER_ID')
	}
	const store: Store = {
		token: await accessToken(JSON.parse(key) as ServiceAccountKey),
		item: `publishers/${publisher}/items/${process.env.CWS_EXTENSION_ID || EXTENSION_ID}`,
	}
	if (command === 'status') {
		const status = await fetchStatus(store)
		console.log(JSON.stringify({
			published: versionsOf(status.publishedItemRevisionStatus),
			submitted: status.submittedItemRevisionStatus ? { versions: versionsOf(status.submittedItemRevisionStatus), state: status.submittedItemRevisionStatus.state } : null,
		}, null, 2))
	} else {
		await release(store, readFileSync(file!))
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((e: unknown) => {
		console.error(e instanceof Error ? e.message : e)
		process.exitCode = 1
	})
}
