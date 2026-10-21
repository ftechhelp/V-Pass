import { strToU8, zipSync } from 'fflate'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type ItemStatus, type Store, accessToken, compareVersions, planRelease, release } from '../scripts/web-store.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const pkg = (version: string) => zipSync({ 'manifest.json': strToU8(JSON.stringify({ manifest_version: 3, version })) })
const store: Store = { token: 'tok', item: 'publishers/pub/items/ext' }
const channel = (crxVersion: string) => ({ distributionChannels: [{ crxVersion, deployPercentage: 100 }] })

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('Chrome Web Store uploads', () => {
	it('signs in as the service account with an RS256 JWT for the Web Store scope', async () => {
		const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json({ access_token: 'ya29.token', expires_in: 3600 }))
		vi.stubGlobal('fetch', fetchMock)

		const token = await accessToken({ client_email: 'ci@project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string }, 1_700_000_000_000)

		expect(token).toBe('ya29.token')
		const [url, init] = fetchMock.mock.calls[0]!
		expect(url).toBe('https://oauth2.googleapis.com/token')
		const form = new URLSearchParams(String(init.body))
		expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
		const [header, claims, signature] = form.get('assertion')!.split('.')
		expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
		expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toEqual({
			iss: 'ci@project.iam.gserviceaccount.com',
			scope: 'https://www.googleapis.com/auth/chromewebstore',
			aud: 'https://oauth2.googleapis.com/token',
			iat: 1_700_000_000,
			exp: 1_700_000_600,
		})
		expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true)
	})

	it('reports a failed sign-in', async () => {
		const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
		vi.stubGlobal('fetch', async () => json({ error: 'invalid_grant' }, 400))
		await expect(accessToken({ client_email: 'x', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string })).rejects.toThrow(/HTTP 400.*invalid_grant/)
	})

	it('compares versions numerically', () => {
		expect(compareVersions('0.10.0', '0.9.1')).toBe(1)
		expect(compareVersions('0.2', '0.2.0')).toBe(0)
		expect(compareVersions('0.1.9', '0.2.0')).toBe(-1)
	})

	it('uploads only versions newer than the store has, replacing an older pending review', () => {
		const published: ItemStatus = { publishedItemRevisionStatus: { state: 'PUBLISHED', ...channel('0.1.0') } }
		expect(planRelease('0.2.0', published)).toEqual({ upload: true, cancelPending: false })
		expect(planRelease('0.1.0', published)).toMatchObject({ upload: false, reason: 'The store already publishes 0.1.0' })
		const pending: ItemStatus = { ...published, submittedItemRevisionStatus: { state: 'PENDING_REVIEW', ...channel('0.2.0') } }
		expect(planRelease('0.2.0', pending)).toMatchObject({ upload: false, reason: '0.2.0 is already submitted (PENDING_REVIEW)' })
		expect(planRelease('0.3.0', pending)).toEqual({ upload: true, cancelPending: true })
		const rejected: ItemStatus = { ...published, submittedItemRevisionStatus: { state: 'REJECTED', ...channel('0.2.0') } }
		expect(planRelease('0.3.0', rejected)).toEqual({ upload: true, cancelPending: false })
		expect(planRelease('0.1.0', {})).toEqual({ upload: true, cancelPending: false })
	})

	it('cancels the older review, uploads, waits for processing and submits for review', async () => {
		const calls: string[] = []
		let publishBody = ''
		let statusCalls = 0
		vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
			const path = url.replace('https://chromewebstore.googleapis.com', '')
			calls.push(`${init.method} ${path}`)
			expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok')
			if (path.endsWith(':fetchStatus')) {
				statusCalls++
				return statusCalls === 1
					? json({ publishedItemRevisionStatus: { state: 'PUBLISHED', ...channel('0.1.0') }, submittedItemRevisionStatus: { state: 'PENDING_REVIEW', ...channel('0.1.1') } })
					: json({ lastAsyncUploadState: 'SUCCEEDED' })
			}
			if (path.endsWith(':cancelSubmission')) return new Response('', { status: 200 })
			if (path.endsWith(':upload')) return json({ itemId: 'ext', uploadState: 'IN_PROGRESS' })
			if (path.endsWith(':publish')) {
				publishBody = String(init.body)
				return json({ itemId: 'ext', state: 'PENDING_REVIEW' })
			}
			return json({ error: 'unexpected' }, 404)
		})
		const log: string[] = []

		await release(store, pkg('0.2.0'), (line) => log.push(line), async () => {})

		expect(calls).toEqual([
			'GET /v2/publishers/pub/items/ext:fetchStatus',
			'POST /v2/publishers/pub/items/ext:cancelSubmission',
			'POST /upload/v2/publishers/pub/items/ext:upload',
			'GET /v2/publishers/pub/items/ext:fetchStatus',
			'POST /v2/publishers/pub/items/ext:publish',
		])
		expect(JSON.parse(publishBody)).toEqual({ publishType: 'DEFAULT_PUBLISH' })
		expect(log.at(-1)).toContain('Submitted (PENDING_REVIEW)')
	})

	it('does nothing when the store already has the version, and stops on a failed upload', async () => {
		vi.stubGlobal('fetch', async () => json({ submittedItemRevisionStatus: { state: 'PENDING_REVIEW', ...channel('0.2.0') } }))
		const log: string[] = []
		await release(store, pkg('0.2.0'), (line) => log.push(line))
		expect(log).toEqual(['0.2.0 is already submitted (PENDING_REVIEW); nothing to upload for 0.2.0.'])

		vi.stubGlobal('fetch', async (url: string) => url.endsWith(':upload') ? json({ uploadState: 'FAILED' }) : json({}))
		await expect(release(store, pkg('0.3.0'), () => {})).rejects.toThrow(/did not succeed \(FAILED\)/)

		vi.stubGlobal('fetch', async (url: string) => url.endsWith(':upload') ? new Response('{"error":{"message":"version too low"}}', { status: 400 }) : json({}))
		await expect(release(store, pkg('0.3.0'), () => {})).rejects.toThrow(/HTTP 400\n.*version too low/)
	})
})
