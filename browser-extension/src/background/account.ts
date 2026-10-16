import { VPassApi, createFetchTransport } from '@vpass/core'
import { type Account, local, session } from './storage.ts'

/**
 * Connecting to Nextcloud with Login Flow v2: the user signs in (with 2FA) in a
 * normal tab and grants access; V-Pass then receives an app password that only
 * this extension uses. It is revocable in Nextcloud → Settings → Security, and
 * it only ever fetches ciphertext.
 */

interface LoginFlow {
	server: string
	endpoint: string
	token: string
	loginUrl: string
	tabId: number | null
	expires: number
}

const FLOW_KEY = 'map:loginFlow'
const FLOW_ALARM = 'login-flow'

let accountCache: Account | null | undefined
let apiCache: VPassApi | null = null
let pollTimer: ReturnType<typeof setTimeout> | undefined

/** Fetch without cookies: a Nextcloud browser session must never mix with the app password. */
const noCookies: typeof fetch = (input, init) => fetch(input, { ...init, credentials: 'omit', cache: 'no-store' })

export async function getAccount(): Promise<Account | null> {
	if (accountCache === undefined) {
		accountCache = (await local.get('account')) ?? null
	}
	return accountCache
}

export async function api(): Promise<VPassApi> {
	const account = await getAccount()
	if (!account) {
		throw new Error('V-Pass is not connected to Nextcloud yet')
	}
	apiCache ??= new VPassApi(createFetchTransport({
		baseUrl: account.server,
		user: account.loginName,
		appPassword: account.appPassword,
		fetch: noCookies,
	}))
	return apiCache
}

/** "cloud.example.com", "https://cloud.example.com/index.php/apps/files" → "https://cloud.example.com" */
export function normaliseServer(input: string): string {
	let value = input.trim()
	if (!/^https?:\/\//i.test(value)) {
		value = `https://${value}`
	}
	const url = new URL(value)
	const path = url.pathname.replace(/\/(index\.php|apps|login|settings|ocs)(\/.*)?$/, '').replace(/\/+$/, '')
	return `${url.origin}${path}`
}

async function getFlow(): Promise<LoginFlow | null> {
	const stored = await session.get(FLOW_KEY)
	return (stored as unknown as LoginFlow | undefined) ?? null
}

export async function loginFlowUrl(): Promise<string | null> {
	return (await getFlow())?.loginUrl ?? null
}

export async function startLoginFlow(serverInput: string, onConnected: () => Promise<void>): Promise<void> {
	const server = normaliseServer(serverInput)
	const url = new URL(server)
	if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
		throw new Error('Use an https:// address: V-Pass will not send your login over plain http')
	}
	let res: Response
	try {
		res = await noCookies(`${server}/index.php/login/v2`, { method: 'POST', headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' } })
	} catch {
		throw new Error(`Could not reach ${url.host}. Check the address and your connection.`)
	}
	if (!res.ok) {
		throw new Error(`${url.host} did not accept the login request (HTTP ${res.status}). Is this a Nextcloud server?`)
	}
	const data = await res.json() as { poll?: { token: string, endpoint: string }, login?: string }
	if (!data.poll?.token || !data.poll.endpoint || !data.login) {
		throw new Error(`${url.host} does not look like a Nextcloud server`)
	}
	const tab = await chrome.tabs.create({ url: data.login })
	const flow: LoginFlow = {
		server,
		endpoint: data.poll.endpoint,
		token: data.poll.token,
		loginUrl: data.login,
		tabId: tab.id ?? null,
		// Nextcloud expires login flow tokens after 20 minutes.
		expires: Date.now() + 20 * 60_000,
	}
	await session.set({ [FLOW_KEY]: flow as unknown as Record<string, unknown> })
	await chrome.alarms.create(FLOW_ALARM, { periodInMinutes: 0.5 })
	schedulePoll(onConnected, 1000)
}

export async function cancelLoginFlow(): Promise<void> {
	clearTimeout(pollTimer)
	await chrome.alarms.clear(FLOW_ALARM)
	await session.remove(FLOW_KEY)
}

function schedulePoll(onConnected: () => Promise<void>, delay = 2000): void {
	clearTimeout(pollTimer)
	pollTimer = setTimeout(() => {
		pollLoginFlow(onConnected).then((pending) => {
			if (pending) schedulePoll(onConnected)
		}).catch((e) => console.error('V-Pass login flow', e))
	}, delay)
}

/**
 * Poll once. Called from a timer while the worker runs, from the 30-second
 * alarm after it was stopped, and when the login tab changes.
 * Returns true while the flow is still waiting for the user.
 */
export async function pollLoginFlow(onConnected: () => Promise<void>): Promise<boolean> {
	const flow = await getFlow()
	if (!flow) {
		return false
	}
	if (Date.now() > flow.expires) {
		await cancelLoginFlow()
		return false
	}
	let res: Response
	try {
		res = await noCookies(flow.endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
			body: new URLSearchParams({ token: flow.token }),
		})
	} catch {
		return true
	}
	if (res.status === 404) {
		return true
	}
	if (!res.ok) {
		await cancelLoginFlow()
		throw new Error(`Login flow failed with HTTP ${res.status}`)
	}
	const result = await res.json() as { server: string, loginName: string, appPassword: string }
	await cancelLoginFlow()
	const account: Account = { server: result.server.replace(/\/+$/, '') || flow.server, loginName: result.loginName, appPassword: result.appPassword }
	await local.set({ account })
	accountCache = account
	apiCache = null
	if (flow.tabId !== null) {
		chrome.tabs.remove(flow.tabId).catch(() => {})
	}
	await onConnected()
	return false
}

export async function isLoginFlowTab(tabId: number): Promise<boolean> {
	return (await getFlow())?.tabId === tabId
}

export { FLOW_ALARM }

/** Revoke the app password on the server (best effort) and forget the account. */
export async function disconnect(): Promise<void> {
	await cancelLoginFlow()
	const account = await getAccount()
	if (account) {
		try {
			await noCookies(`${account.server}/ocs/v2.php/core/apppassword`, {
				method: 'DELETE',
				headers: {
					'OCS-APIRequest': 'true',
					Authorization: `Basic ${btoa(unescape(encodeURIComponent(`${account.loginName}:${account.appPassword}`)))}`,
				},
			})
		} catch {
			// Offline: the app password stays valid until revoked in Nextcloud's security settings.
		}
	}
	accountCache = null
	apiCache = null
}
