import {
	type AuthenticationResponseJSON as SwaAuthenticationResponse,
	type RegistrationResponseJSON as SwaRegistrationResponse,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { beforeAll, describe, expect, it } from 'vitest'
import {
	type CreationOptionsJSON,
	type RequestOptionsJSON,
	ES256,
	RS256,
	VPASS_AAGUID,
	WebAuthnError,
	b64urlDecode,
	b64urlEncode,
	cborEncode,
	chooseAlgorithm,
	createCredential,
	decryptItem,
	encryptItem,
	generateKey,
	getAssertion,
	initCrypto,
	isExcluded,
	newItem,
	passkeyMatchesRequest,
	randomBytes,
	rawEcdsaToDer,
	resolveRpId,
	utf8Decode,
} from '../src/index.ts'

const ORIGIN = 'https://login.example.com'
const RP_ID = 'example.com'

function creationOptions(overrides: Partial<CreationOptionsJSON> = {}): CreationOptionsJSON {
	return {
		rp: { id: RP_ID, name: 'Example' },
		user: { id: b64urlEncode(randomBytes(16)), name: 'alice@example.com', displayName: 'Alice' },
		challenge: b64urlEncode(randomBytes(32)),
		pubKeyCredParams: [{ type: 'public-key', alg: ES256 }],
		authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
		extensions: { credProps: true },
		...overrides,
	}
}

function requestOptions(overrides: Partial<RequestOptionsJSON> = {}): RequestOptionsJSON {
	return { challenge: b64urlEncode(randomBytes(32)), rpId: RP_ID, userVerification: 'required', ...overrides }
}

async function expectWebAuthnError(promise: Promise<unknown> | (() => unknown), name: string): Promise<void> {
	try {
		await (typeof promise === 'function' ? promise() : promise)
	} catch (e) {
		expect(e).toBeInstanceOf(WebAuthnError)
		expect((e as WebAuthnError).domName).toBe(name)
		return
	}
	throw new Error(`expected ${name}`)
}

describe('software authenticator', () => {
	for (const [label, alg] of [['ES256', ES256], ['RS256', RS256]] as const) {
		it(`registers and signs in with ${label}, verified by @simplewebauthn/server`, async () => {
			const options = creationOptions({ pubKeyCredParams: [{ type: 'public-key', alg }] })
			const { passkey, response } = await createCredential(options, { origin: ORIGIN })

			expect(passkey).toMatchObject({ rpId: RP_ID, rpName: 'Example', userName: 'alice@example.com', algorithm: alg, signCount: 0 })
			expect(passkey.userHandle).toBe(options.user.id)
			expect(response.clientExtensionResults).toEqual({ credProps: { rk: true } })
			expect(response.response.publicKeyAlgorithm).toBe(alg)

			const registration = await verifyRegistrationResponse({
				response: response as unknown as SwaRegistrationResponse,
				expectedChallenge: options.challenge,
				expectedOrigin: ORIGIN,
				expectedRPID: RP_ID,
				requireUserVerification: true,
			})
			expect(registration.verified).toBe(true)
			const info = registration.registrationInfo!
			expect(info.fmt).toBe('none')
			expect(info.aaguid).toBe(VPASS_AAGUID)
			expect(info.credentialDeviceType).toBe('multiDevice')
			expect(info.credentialBackedUp).toBe(true)
			expect(info.userVerified).toBe(true)
			expect(info.credential.id).toBe(passkey.credentialId)

			const request = requestOptions({ allowCredentials: [{ type: 'public-key', id: passkey.credentialId }] })
			const assertion = await getAssertion(request, passkey, { origin: ORIGIN })
			expect(assertion.response.userHandle).toBe(passkey.userHandle)
			const authentication = await verifyAuthenticationResponse({
				response: assertion as unknown as SwaAuthenticationResponse,
				expectedChallenge: request.challenge,
				expectedOrigin: ORIGIN,
				expectedRPID: RP_ID,
				credential: info.credential,
				requireUserVerification: true,
			})
			expect(authentication.verified).toBe(true)
			expect(authentication.authenticationInfo.newCounter).toBe(0)
		})
	}

	it('still signs after the passkey round-trips through an encrypted login item', async () => {
		await initCrypto()
		const options = creationOptions()
		const { passkey, response } = await createCredential(options, { origin: ORIGIN })
		const registration = await verifyRegistrationResponse({
			response: response as unknown as SwaRegistrationResponse,
			expectedChallenge: options.challenge,
			expectedOrigin: ORIGIN,
			expectedRPID: RP_ID,
		})

		const vaultKey = generateKey()
		const enc = encryptItem(vaultKey, 'b7c2f1a4-0e1d-4c2b-9f3a-5d6e7f809a1b', newItem('login', { title: 'Example', passkeys: [passkey] }))
		const decrypted = decryptItem(vaultKey, { ...enc, revision: 1, createdAt: 0, updatedAt: 0, deletedAt: null })
		const stored = decrypted.item.type === 'login' ? decrypted.item.passkeys[0]! : null

		const request = requestOptions()
		const assertion = await getAssertion(request, stored!, { origin: ORIGIN })
		const result = await verifyAuthenticationResponse({
			response: assertion as unknown as SwaAuthenticationResponse,
			expectedChallenge: request.challenge,
			expectedOrigin: ORIGIN,
			expectedRPID: RP_ID,
			credential: registration.registrationInfo!.credential,
		})
		expect(result.verified).toBe(true)
	})

	it('describes cross-origin iframe calls in clientDataJSON', async () => {
		const { response } = await createCredential(creationOptions(), { origin: ORIGIN, topOrigin: 'https://shop.test' })
		const clientData = JSON.parse(utf8Decode(b64urlDecode(response.response.clientDataJSON)))
		expect(clientData).toMatchObject({ type: 'webauthn.create', origin: ORIGIN, crossOrigin: true, topOrigin: 'https://shop.test' })

		const sameOrigin = await createCredential(creationOptions(), { origin: ORIGIN, topOrigin: ORIGIN })
		const plain = JSON.parse(utf8Decode(b64urlDecode(sameOrigin.response.response.clientDataJSON)))
		expect(plain.crossOrigin).toBe(false)
		expect(plain).not.toHaveProperty('topOrigin')
	})

	it('omits the UV flag when the user did not verify, and refuses when the site requires it', async () => {
		await expectWebAuthnError(createCredential(creationOptions(), { origin: ORIGIN }, { userVerified: false }), 'NotAllowedError')
		const options = creationOptions({ authenticatorSelection: { userVerification: 'preferred' } })
		const { response } = await createCredential(options, { origin: ORIGIN }, { userVerified: false })
		const registration = await verifyRegistrationResponse({
			response: response as unknown as SwaRegistrationResponse,
			expectedChallenge: options.challenge,
			expectedOrigin: ORIGIN,
			expectedRPID: RP_ID,
			requireUserVerification: false,
		})
		expect(registration.registrationInfo!.userVerified).toBe(false)
	})

	it('rejects unsupported algorithms, wrong sites and unlisted credentials', async () => {
		await expectWebAuthnError(createCredential(creationOptions({ pubKeyCredParams: [{ type: 'public-key', alg: -8 }] }), { origin: ORIGIN }), 'NotSupportedError')
		await expectWebAuthnError(createCredential(creationOptions({ user: { id: '', name: 'x', displayName: 'x' } }), { origin: ORIGIN }), 'NotSupportedError')

		const { passkey } = await createCredential(creationOptions(), { origin: ORIGIN })
		await expectWebAuthnError(getAssertion(requestOptions({ rpId: 'other.com' }), passkey, { origin: 'https://other.com' }), 'NotAllowedError')
		await expectWebAuthnError(getAssertion(requestOptions({ allowCredentials: [{ type: 'public-key', id: 'AAAA' }] }), passkey, { origin: ORIGIN }), 'NotAllowedError')
		await expectWebAuthnError(getAssertion(requestOptions(), passkey, { origin: 'https://evil.test' }), 'SecurityError')
	})

	it('picks algorithms and matches credential lists', () => {
		expect(chooseAlgorithm([{ type: 'public-key', alg: -8 }, { type: 'public-key', alg: RS256 }, { type: 'public-key', alg: ES256 }])).toBe(RS256)
		expect(chooseAlgorithm([])).toBe(ES256)
		expect(chooseAlgorithm([{ type: 'public-key', alg: -8 }])).toBeNull()

		const pk = { rpId: RP_ID, credentialId: 'abc' }
		expect(passkeyMatchesRequest(pk, RP_ID)).toBe(true)
		expect(passkeyMatchesRequest(pk, RP_ID, [{ type: 'public-key', id: 'abc' }])).toBe(true)
		expect(passkeyMatchesRequest(pk, RP_ID, [{ type: 'public-key', id: 'xyz' }])).toBe(false)
		expect(passkeyMatchesRequest(pk, 'other.com')).toBe(false)
		expect(isExcluded([pk], RP_ID, [{ type: 'public-key', id: 'abc' }])).toBe(true)
		expect(isExcluded([pk], 'other.com', [{ type: 'public-key', id: 'abc' }])).toBe(false)
		expect(isExcluded([pk], RP_ID, [])).toBe(false)
	})
})

describe('relying party IDs', () => {
	it('accepts the host and its registrable parents', () => {
		expect(resolveRpId('https://login.example.com')).toBe('login.example.com')
		expect(resolveRpId('https://login.example.com', 'example.com')).toBe('example.com')
		expect(resolveRpId('https://a.b.example.co.uk', 'EXAMPLE.co.uk')).toBe('example.co.uk')
		expect(resolveRpId('http://localhost:3000')).toBe('localhost')
		expect(resolveRpId('https://alice.github.io', 'alice.github.io')).toBe('alice.github.io')
	})

	it('rejects public suffixes, unrelated hosts, IPs and insecure origins', async () => {
		await expectWebAuthnError(() => resolveRpId('https://example.com', 'com'), 'SecurityError')
		await expectWebAuthnError(() => resolveRpId('https://a.example.co.uk', 'co.uk'), 'SecurityError')
		await expectWebAuthnError(() => resolveRpId('https://alice.github.io', 'github.io'), 'SecurityError')
		await expectWebAuthnError(() => resolveRpId('https://example.com', 'evil.com'), 'SecurityError')
		await expectWebAuthnError(() => resolveRpId('https://notexample.com', 'example.com'), 'SecurityError')
		await expectWebAuthnError(() => resolveRpId('https://192.168.1.10'), 'SecurityError')
		await expectWebAuthnError(() => resolveRpId('http://example.com'), 'SecurityError')
		await expectWebAuthnError(() => resolveRpId('https://example.com', '.example.com'), 'SecurityError')
	})
})

describe('encoding helpers', () => {
	it('encodes CBOR like the RFC 8949 examples', () => {
		const hex = (v: Parameters<typeof cborEncode>[0]) => Buffer.from(cborEncode(v)).toString('hex')
		expect(hex(0)).toBe('00')
		expect(hex(23)).toBe('17')
		expect(hex(24)).toBe('1818')
		expect(hex(256)).toBe('190100')
		expect(hex(1000000)).toBe('1a000f4240')
		expect(hex(2 ** 32)).toBe('1b0000000100000000')
		expect(hex(-1)).toBe('20')
		expect(hex(-25)).toBe('3818')
		expect(hex(-257)).toBe('390100')
		expect(hex('IETF')).toBe('6449455446')
		expect(hex(new Uint8Array([1, 2, 3, 4]))).toBe('4401020304')
		expect(hex([1, [2, 3]])).toBe('8201820203')
		expect(hex(new Map([[1, 2], [3, 4]]))).toBe('a201020304')
		expect(hex(new Map([['a', true], ['b', null]]))).toBe('a26161f56162f6')
		expect(() => cborEncode(1.5)).toThrow()
	})

	it('converts raw ECDSA signatures to DER, padding high bits', () => {
		const r = new Uint8Array(32).fill(0x80)
		const s = new Uint8Array(32)
		s[31] = 1
		const der = rawEcdsaToDer(new Uint8Array([...r, ...s]))
		expect(Buffer.from(der).toString('hex')).toBe(`3026022100${'80'.repeat(32)}020101`)
	})
})
