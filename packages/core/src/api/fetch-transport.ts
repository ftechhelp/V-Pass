import { ApiError, type Transport, type TransportRequest } from './client.ts'

export interface FetchTransportOptions {
	/** Nextcloud base URL, e.g. https://cloud.example.com (no trailing slash). */
	baseUrl: string
	/** Login name and an app password from Login Flow v2 (never the real password in clients). */
	user: string
	appPassword: string
	fetch?: typeof fetch
}

/**
 * Transport for clients outside the Nextcloud web UI (browser extension, desktop
 * client, scripts, tests): plain fetch + HTTP Basic auth with an app password.
 */
export function createFetchTransport(options: FetchTransportOptions): Transport {
	const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
	const auth = `Basic ${btoa(unescape(encodeURIComponent(`${options.user}:${options.appPassword}`)))}`
	const base = options.baseUrl.replace(/\/+$/, '')

	return {
		async request<T>(req: TransportRequest): Promise<T> {
			const url = new URL(`${base}/ocs/v2.php/apps/vpass/api/v1${req.path}`)
			for (const [key, value] of Object.entries(req.query ?? {})) {
				url.searchParams.set(key, String(value))
			}
			const headers: Record<string, string> = {
				'OCS-APIRequest': 'true',
				Accept: req.responseType === 'arraybuffer' ? 'application/octet-stream' : 'application/json',
				Authorization: auth,
			}
			let body: BodyInit | undefined
			if (req.form) {
				body = req.form
			} else if (req.json !== undefined) {
				body = JSON.stringify(req.json)
				headers['Content-Type'] = 'application/json'
			}

			const res = await doFetch(url, { method: req.method, headers, body })
			if (res.ok && req.responseType === 'arraybuffer') {
				return await res.arrayBuffer() as T
			}
			const text = await res.text()
			let parsed: { ocs?: { meta?: { message?: string }, data?: unknown } } | undefined
			try {
				parsed = JSON.parse(text)
			} catch {
				parsed = undefined
			}
			if (!res.ok) {
				const data = parsed?.ocs?.data as { message?: string } | undefined
				throw new ApiError(res.status, data?.message || parsed?.ocs?.meta?.message || `HTTP ${res.status}`, data)
			}
			return parsed?.ocs?.data as T
		},
	}
}
