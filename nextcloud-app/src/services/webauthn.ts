import { b64urlDecode, b64urlEncode, newPrfSalt, randomBytes } from '@vpass/core'
import type { UnlockKeyRecord } from '@vpass/core'

/**
 * WebAuthn PRF helpers for "unlock with passkey". The relying party is this
 * Nextcloud host. We only use the PRF output as key material; no server-side
 * WebAuthn verification is needed because the wrapped vault key is useless
 * without it.
 */

export class PrfUnsupportedError extends Error {
	constructor() {
		super('This passkey or browser does not support the PRF extension needed to unlock the vault.')
		this.name = 'PrfUnsupportedError'
	}
}

export function webauthnAvailable(): boolean {
	return typeof window !== 'undefined' && window.isSecureContext && typeof window.PublicKeyCredential !== 'undefined'
}

const buf = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer

interface PrfResults {
	results?: { first?: ArrayBuffer }
	enabled?: boolean
}

export interface RegisteredPrfCredential {
	credentialId: string
	prfSalt: string
	prfOutput: Uint8Array
}

/**
 * Create a new passkey and evaluate PRF. Some authenticators only report PRF
 * support at creation and return the output on the first assertion, so we
 * fall back to an immediate get() when needed.
 */
export async function registerPrfCredential(userId: string, userName: string, displayName: string): Promise<RegisteredPrfCredential> {
	const prfSalt = newPrfSalt()
	const credential = await navigator.credentials.create({
		publicKey: {
			rp: { name: 'V-Pass', id: window.location.hostname },
			user: { id: buf(randomBytes(32)), name: `${userName} (V-Pass)`, displayName: `${displayName} — V-Pass unlock` },
			challenge: buf(randomBytes(32)),
			pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }, { type: 'public-key', alg: -8 }],
			authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
			timeout: 120_000,
			extensions: { prf: { eval: { first: buf(b64urlDecode(prfSalt)) } } } as AuthenticationExtensionsClientInputs,
		},
	}) as PublicKeyCredential | null
	if (!credential) {
		throw new Error('Passkey creation was cancelled')
	}
	const credentialId = b64urlEncode(new Uint8Array(credential.rawId))
	const prf = (credential.getClientExtensionResults() as { prf?: PrfResults }).prf
	if (!prf?.enabled && !prf?.results?.first) {
		throw new PrfUnsupportedError()
	}
	const prfOutput = prf.results?.first
		? new Uint8Array(prf.results.first)
		: (await evaluatePrf([{ id: 0, credentialId, prfSalt } as UnlockKeyRecord])).prfOutput
	return { credentialId, prfSalt, prfOutput }
}

/** Ask the user to touch one of their registered unlock passkeys. */
export async function evaluatePrf(keys: Pick<UnlockKeyRecord, 'id' | 'credentialId' | 'prfSalt'>[]): Promise<{ key: Pick<UnlockKeyRecord, 'id' | 'credentialId' | 'prfSalt'>, prfOutput: Uint8Array }> {
	if (keys.length === 0) {
		throw new Error('No passkeys are set up for unlocking')
	}
	const evalByCredential: Record<string, { first: ArrayBuffer }> = {}
	for (const key of keys) {
		evalByCredential[key.credentialId] = { first: buf(b64urlDecode(key.prfSalt)) }
	}
	const assertion = await navigator.credentials.get({
		publicKey: {
			challenge: buf(randomBytes(32)),
			rpId: window.location.hostname,
			allowCredentials: keys.map((k) => ({ type: 'public-key' as const, id: buf(b64urlDecode(k.credentialId)) })),
			userVerification: 'required',
			timeout: 120_000,
			extensions: { prf: { evalByCredential } } as AuthenticationExtensionsClientInputs,
		},
	}) as PublicKeyCredential | null
	if (!assertion) {
		throw new Error('Passkey unlock was cancelled')
	}
	const credentialId = b64urlEncode(new Uint8Array(assertion.rawId))
	const key = keys.find((k) => k.credentialId === credentialId)
	const first = (assertion.getClientExtensionResults() as { prf?: PrfResults }).prf?.results?.first
	if (!key || !first) {
		throw new PrfUnsupportedError()
	}
	return { key, prfOutput: new Uint8Array(first) }
}
