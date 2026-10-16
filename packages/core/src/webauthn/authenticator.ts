import { b64urlDecode, b64urlEncode, concatBytes, utf8Encode } from '../crypto/encoding.ts'
import { EncodingError } from '../crypto/errors.ts'
import { randomBytes } from '../crypto/random.ts'
import { type Passkey, PasskeySchema } from '../model/items.ts'
import { type CborKey, type CborValue, cborEncode } from './cbor.ts'
import { WebAuthnError, resolveRpId } from './rp.ts'

/**
 * A software WebAuthn authenticator whose credentials live in the vault
 * (`login.passkeys[]`). It speaks the JSON forms of the WebAuthn options and
 * responses (base64url for every binary field), so requests can cross the
 * page → extension messaging boundary and the results go straight back to
 * `PublicKeyCredential`-shaped objects in the page.
 *
 * - ES256 and RS256 only. Keys are generated with WebCrypto; the private key is
 *   stored as PKCS#8 (base64url) inside the encrypted item.
 * - Attestation is always "none" with the V-Pass AAGUID.
 * - Flags: UP, UV (when the user confirmed in V-Pass), BE and BS (the passkey is
 *   synced). The signature counter is always 0, as for other synced passkeys,
 *   so syncing between devices never trips a site's clone detection.
 */

export const VPASS_AAGUID = 'ba7969c9-c736-4440-86e6-a7d983855a46'
const AAGUID_BYTES = Uint8Array.from(VPASS_AAGUID.replace(/-/g, '').match(/../g)!.map((h) => parseInt(h, 16)))

export const ES256 = -7
export const RS256 = -257
const SUPPORTED_ALGORITHMS: readonly number[] = [ES256, RS256]

const FLAG = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40 } as const

export type AuthenticatorTransport = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb'

export interface CredentialDescriptorJSON {
	type: 'public-key'
	/** base64url */
	id: string
	transports?: AuthenticatorTransport[]
}

export interface CreationOptionsJSON {
	rp: { id?: string, name: string }
	/** `user.id` is base64url. */
	user: { id: string, name: string, displayName: string }
	challenge: string
	pubKeyCredParams: { type: 'public-key', alg: number }[]
	timeout?: number
	excludeCredentials?: CredentialDescriptorJSON[]
	authenticatorSelection?: {
		authenticatorAttachment?: 'platform' | 'cross-platform'
		residentKey?: 'discouraged' | 'preferred' | 'required'
		requireResidentKey?: boolean
		userVerification?: 'discouraged' | 'preferred' | 'required'
	}
	attestation?: 'none' | 'indirect' | 'direct' | 'enterprise'
	extensions?: Record<string, unknown>
}

export interface RequestOptionsJSON {
	challenge: string
	timeout?: number
	rpId?: string
	allowCredentials?: CredentialDescriptorJSON[]
	userVerification?: 'discouraged' | 'preferred' | 'required'
	extensions?: Record<string, unknown>
}

export interface RegistrationResponseJSON {
	id: string
	rawId: string
	type: 'public-key'
	response: {
		clientDataJSON: string
		attestationObject: string
		authenticatorData: string
		transports: AuthenticatorTransport[]
		/** SubjectPublicKeyInfo (DER), base64url. */
		publicKey: string
		publicKeyAlgorithm: number
	}
	authenticatorAttachment: 'platform'
	clientExtensionResults: Record<string, unknown>
}

export interface AuthenticationResponseJSON {
	id: string
	rawId: string
	type: 'public-key'
	response: {
		clientDataJSON: string
		authenticatorData: string
		signature: string
		userHandle?: string
	}
	authenticatorAttachment: 'platform'
	clientExtensionResults: Record<string, unknown>
}

/** Where the request comes from. Always taken from the browser, never from the page. */
export interface ClientContext {
	/** Origin of the frame that called navigator.credentials. */
	origin: string
	/** Origin of the top-level page when the call comes from a cross-origin iframe. */
	topOrigin?: string
}

export interface UserConsent {
	/** True when the user confirmed in V-Pass UI while the vault was unlocked. Default true. */
	userVerified?: boolean
}

/* ---------- request helpers (also used to pick passkeys from the vault) ---------- */

/** The first algorithm the site asked for that V-Pass supports (an empty list means ES256/RS256). */
export function chooseAlgorithm(params: CreationOptionsJSON['pubKeyCredParams'] | undefined): number | null {
	const requested = params?.length ? params.filter((p) => p.type === 'public-key').map((p) => p.alg) : [ES256, RS256]
	return requested.find((alg) => SUPPORTED_ALGORITHMS.includes(alg)) ?? null
}

/** Whether `passkey` answers a get() request for `rpId` (honouring allowCredentials). */
export function passkeyMatchesRequest(passkey: Pick<Passkey, 'rpId' | 'credentialId'>, rpId: string, allowCredentials?: CredentialDescriptorJSON[]): boolean {
	if (passkey.rpId !== rpId) {
		return false
	}
	return !allowCredentials?.length || allowCredentials.some((c) => c.id === passkey.credentialId)
}

/** Whether a create() request must fail because the vault already holds one of the excluded credentials. */
export function isExcluded(passkeys: Iterable<Pick<Passkey, 'rpId' | 'credentialId'>>, rpId: string, excludeCredentials?: CredentialDescriptorJSON[]): boolean {
	if (!excludeCredentials?.length) {
		return false
	}
	const excluded = new Set(excludeCredentials.map((c) => c.id))
	for (const passkey of passkeys) {
		if (passkey.rpId === rpId && excluded.has(passkey.credentialId)) {
			return true
		}
	}
	return false
}

/* ---------- operations ---------- */

export interface NewPasskey {
	passkey: Passkey
	response: RegistrationResponseJSON
}

export async function createCredential(options: CreationOptionsJSON, ctx: ClientContext, consent: UserConsent = {}): Promise<NewPasskey> {
	const rpId = resolveRpId(ctx.origin, options.rp.id)
	const alg = chooseAlgorithm(options.pubKeyCredParams)
	if (alg === null) {
		throw new WebAuthnError('NotSupportedError', 'None of the key types this site asked for is supported by V-Pass')
	}
	const userVerified = consent.userVerified ?? true
	if (options.authenticatorSelection?.userVerification === 'required' && !userVerified) {
		throw new WebAuthnError('NotAllowedError', 'User verification is required')
	}
	const userHandle = decodeField(options.user.id, 'user.id')
	if (userHandle.length < 1 || userHandle.length > 64) {
		throw new WebAuthnError('NotSupportedError', 'user.id must be 1 to 64 bytes')
	}

	const keys = await generateKeyPair(alg)
	const credentialId = randomBytes(16)
	const cose = await cosePublicKey(alg, keys.publicKey)
	const attested = concatBytes(AAGUID_BYTES, new Uint8Array([credentialId.length >> 8, credentialId.length & 0xff]), credentialId, cose)
	const flags = FLAG.UP | (userVerified ? FLAG.UV : 0) | FLAG.BE | FLAG.BS | FLAG.AT
	const authData = concatBytes(await rpIdHash(rpId), new Uint8Array([flags]), new Uint8Array(4), attested)
	const attestationObject = cborEncode(new Map<CborKey, CborValue>([
		['fmt', 'none'],
		['attStmt', new Map()],
		['authData', authData],
	]))
	const clientData = clientDataJSON('webauthn.create', options.challenge, ctx)
	const spki = new Uint8Array(await subtle().exportKey('spki', keys.publicKey))
	const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', keys.privateKey))

	const id = b64urlEncode(credentialId)
	const passkey = PasskeySchema.parse({
		credentialId: id,
		rpId,
		rpName: options.rp.name ?? '',
		userHandle: b64urlEncode(userHandle),
		userName: options.user.name ?? '',
		userDisplayName: options.user.displayName ?? '',
		privateKey: b64urlEncode(pkcs8),
		algorithm: alg,
		signCount: 0,
		discoverable: true,
		createdAt: new Date().toISOString(),
	})
	pkcs8.fill(0)

	return {
		passkey,
		response: {
			id,
			rawId: id,
			type: 'public-key',
			response: {
				clientDataJSON: b64urlEncode(clientData),
				attestationObject: b64urlEncode(attestationObject),
				authenticatorData: b64urlEncode(authData),
				transports: ['internal'],
				publicKey: b64urlEncode(spki),
				publicKeyAlgorithm: alg,
			},
			authenticatorAttachment: 'platform',
			clientExtensionResults: options.extensions?.credProps ? { credProps: { rk: true } } : {},
		},
	}
}

export async function getAssertion(options: RequestOptionsJSON, passkey: Passkey, ctx: ClientContext, consent: UserConsent = {}): Promise<AuthenticationResponseJSON> {
	const rpId = resolveRpId(ctx.origin, options.rpId)
	if (!passkeyMatchesRequest(passkey, rpId, options.allowCredentials)) {
		throw new WebAuthnError('NotAllowedError', 'This passkey cannot be used for this request')
	}
	const userVerified = consent.userVerified ?? true
	if (options.userVerification === 'required' && !userVerified) {
		throw new WebAuthnError('NotAllowedError', 'User verification is required')
	}

	const flags = FLAG.UP | (userVerified ? FLAG.UV : 0) | FLAG.BE | FLAG.BS
	const authData = concatBytes(await rpIdHash(rpId), new Uint8Array([flags]), new Uint8Array(4))
	const clientData = clientDataJSON('webauthn.get', options.challenge, ctx)
	const signature = await sign(passkey, concatBytes(authData, await sha256(clientData)))

	return {
		id: passkey.credentialId,
		rawId: passkey.credentialId,
		type: 'public-key',
		response: {
			clientDataJSON: b64urlEncode(clientData),
			authenticatorData: b64urlEncode(authData),
			signature: b64urlEncode(signature),
			...(passkey.userHandle ? { userHandle: passkey.userHandle } : {}),
		},
		authenticatorAttachment: 'platform',
		clientExtensionResults: {},
	}
}

/* ---------- internals ---------- */

function subtle(): SubtleCrypto {
	return globalThis.crypto.subtle
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await subtle().digest('SHA-256', data as BufferSource))
}

function rpIdHash(rpId: string): Promise<Uint8Array> {
	return sha256(utf8Encode(rpId))
}

function decodeField(value: string, name: string): Uint8Array {
	try {
		return b64urlDecode(value)
	} catch (e) {
		if (e instanceof EncodingError) {
			throw new WebAuthnError('NotSupportedError', `${name} is not valid base64url`)
		}
		throw e
	}
}

function clientDataJSON(type: 'webauthn.create' | 'webauthn.get', challenge: string, ctx: ClientContext): Uint8Array {
	const crossOrigin = ctx.topOrigin !== undefined && ctx.topOrigin !== ctx.origin
	// Same member order as browsers produce: type, challenge, origin, crossOrigin, topOrigin.
	const data: Record<string, unknown> = {
		type,
		challenge: b64urlEncode(decodeField(challenge, 'challenge')),
		origin: ctx.origin,
		crossOrigin,
	}
	if (crossOrigin) {
		data.topOrigin = ctx.topOrigin
	}
	return utf8Encode(JSON.stringify(data))
}

function generateKeyPair(alg: number): Promise<CryptoKeyPair> {
	if (alg === ES256) {
		return subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
	}
	return subtle().generateKey({
		name: 'RSASSA-PKCS1-v1_5',
		modulusLength: 2048,
		publicExponent: new Uint8Array([1, 0, 1]),
		hash: 'SHA-256',
	}, true, ['sign', 'verify'])
}

async function cosePublicKey(alg: number, publicKey: CryptoKey): Promise<Uint8Array> {
	const jwk = await subtle().exportKey('jwk', publicKey)
	if (alg === ES256) {
		// kty: EC2, alg: ES256, crv: P-256, x, y (CTAP2 canonical key order)
		return cborEncode(new Map<CborKey, CborValue>([[1, 2], [3, ES256], [-1, 1], [-2, b64urlDecode(jwk.x!)], [-3, b64urlDecode(jwk.y!)]]))
	}
	// kty: RSA, alg: RS256, n, e
	return cborEncode(new Map<CborKey, CborValue>([[1, 3], [3, RS256], [-1, b64urlDecode(jwk.n!)], [-2, b64urlDecode(jwk.e!)]]))
}

async function sign(passkey: Passkey, data: Uint8Array): Promise<Uint8Array> {
	const pkcs8 = decodeField(passkey.privateKey, 'privateKey') as BufferSource
	if (passkey.algorithm === ES256) {
		const key = await subtle().importKey('pkcs8', pkcs8, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
		const raw = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data as BufferSource))
		return rawEcdsaToDer(raw)
	}
	if (passkey.algorithm === RS256) {
		const key = await subtle().importKey('pkcs8', pkcs8, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
		return new Uint8Array(await subtle().sign({ name: 'RSASSA-PKCS1-v1_5' }, key, data as BufferSource))
	}
	throw new WebAuthnError('NotSupportedError', `Passkey algorithm ${passkey.algorithm} is not supported`)
}

/** WebCrypto returns ECDSA signatures as r‖s; WebAuthn wants an ASN.1 DER SEQUENCE. */
export function rawEcdsaToDer(raw: Uint8Array): Uint8Array {
	const half = raw.length / 2
	const r = derInteger(raw.subarray(0, half))
	const s = derInteger(raw.subarray(half))
	return concatBytes(new Uint8Array([0x30, r.length + s.length]), r, s)
}

function derInteger(bytes: Uint8Array): Uint8Array {
	let start = 0
	while (start < bytes.length - 1 && bytes[start] === 0) {
		start++
	}
	let value = bytes.subarray(start)
	if ((value[0] ?? 0) & 0x80) {
		value = concatBytes(new Uint8Array([0]), value)
	}
	return concatBytes(new Uint8Array([0x02, value.length]), value)
}
