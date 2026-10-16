import { VPassApi, createFetchTransport, randomBytes, b64urlEncode } from '@vpass/core'

export const BASE_URL = (process.env.VPASS_URL ?? 'http://localhost:8080').replace(/\/+$/, '')
const ADMIN_USER = process.env.VPASS_ADMIN_USER ?? 'admin'
const ADMIN_PASSWORD = process.env.VPASS_ADMIN_PASSWORD ?? 'admin'

function adminHeaders(): Record<string, string> {
	return {
		'OCS-APIRequest': 'true',
		Accept: 'application/json',
		Authorization: `Basic ${btoa(`${ADMIN_USER}:${ADMIN_PASSWORD}`)}`,
	}
}

export interface TestUser {
	id: string
	password: string
	api: VPassApi
}

/** Create a throwaway Nextcloud user via the provisioning API. */
export async function createTestUser(prefix = 'vpass-test'): Promise<TestUser> {
	const id = `${prefix}-${b64urlEncode(randomBytes(6)).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`
	const password = `Pw-${b64urlEncode(randomBytes(18))}`
	const res = await fetch(`${BASE_URL}/ocs/v2.php/cloud/users`, {
		method: 'POST',
		headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
		body: JSON.stringify({ userid: id, password }),
	})
	if (!res.ok) {
		throw new Error(`Could not create test user (${res.status}): ${await res.text()}. Is the dev instance running (make dev-up)?`)
	}
	return { id, password, api: apiFor(id, password) }
}

export function apiFor(user: string, password: string): VPassApi {
	return new VPassApi(createFetchTransport({ baseUrl: BASE_URL, user, appPassword: password }))
}

export function adminApi(): VPassApi {
	return apiFor(ADMIN_USER, ADMIN_PASSWORD)
}

/** Deleting the user also exercises V-Pass's UserDeletedEvent cleanup. */
export async function deleteTestUser(id: string): Promise<void> {
	await fetch(`${BASE_URL}/ocs/v2.php/cloud/users/${encodeURIComponent(id)}`, { method: 'DELETE', headers: adminHeaders() })
}
