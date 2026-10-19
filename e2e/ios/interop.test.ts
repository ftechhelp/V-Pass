import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	type AuthenticationResponseJSON as SwaAuthenticationResponse,
	type RegistrationResponseJSON as SwaRegistrationResponse,
	type WebAuthnCredential,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from '@simplewebauthn/server'
import {
	type LoginItem,
	VaultCache,
	b64urlEncode,
	createCredential,
	createVaultKeys,
	decryptItem,
	encryptFolder,
	encryptItem,
	getAssertion,
	initCrypto,
	newItem,
	newKdfParams,
	parseItem,
	utf8Encode,
	uuid,
} from '@vpass/core'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { BASE_URL, type TestUser, createTestUser, deleteTestUser } from '../helpers.ts'

/**
 * The Swift client (ios/VPassKit) against the dev server: core seeds a vault,
 * the Swift InteropTests read and write it from Docker, then core checks every
 * write. Run with `make test-ios-interop` (needs `make dev-up`).
 */
const KIT = resolve(fileURLToPath(import.meta.url), '../../../ios/VPassKit')
const MASTER = 'interop master 🔐 ﬁ'
const ORIGIN = 'https://webauthn.io'
const RP_ID = 'webauthn.io'

let user: TestUser
let dir: string
let vaultKey: Uint8Array
let tsCredential: WebAuthnCredential
const seed: Record<string, unknown> = {}
let output: Record<string, any>

beforeAll(async () => {
	await initCrypto()
	user = await createTestUser('vpass-ios')
	dir = mkdtempSync(join(tmpdir(), 'vpass-ios-'))

	const vault = createVaultKeys(MASTER, newKdfParams(2, 32 * 1024 * 1024))
	vaultKey = vault.vaultKey
	await user.api.createVault(vault.keyset)

	const folderId = uuid()
	const folder = encryptFolder(vaultKey, folderId, { schemaVersion: 1, name: 'Shared 📁' })
	await user.api.createFolder({ id: folderId, wrappedKey: folder.wrappedKey, data: folder.data })

	const options = {
		rp: { id: RP_ID, name: 'WebAuthn.io' },
		user: { id: b64urlEncode(utf8Encode('ts-user')), name: 'tess', displayName: 'Tess' },
		challenge: b64urlEncode(utf8Encode('register')),
		pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
	}
	const created = await createCredential(options, { origin: ORIGIN })
	const registration = await verifyRegistrationResponse({
		response: created.response as unknown as SwaRegistrationResponse,
		expectedChallenge: options.challenge,
		expectedOrigin: ORIGIN,
		expectedRPID: RP_ID,
	})
	tsCredential = registration.registrationInfo!.credential

	const inputs = [
		newItem('login', {
			title: 'Edit me',
			username: 'core@example.com',
			password: 'original-password',
			urls: ['https://example.com'],
			folderId,
			totp: 'JBSWY3DPEHPK3PXP',
			customFields: [{ label: 'Security answer', type: 'hidden', value: 'blue' }],
			futureField: { keep: ['me', 1] },
		} as Partial<LoginItem>),
		newItem('login', { title: 'Passkey holder', username: 'tess', urls: [ORIGIN], passkeys: [created.passkey] }),
		newItem('card', { title: 'Card', number: '4111111111111111', expMonth: '01', expYear: '2030' }),
		newItem('identity', { title: 'Me', firstName: 'Ünïcode', email: 'me@example.com' }),
		newItem('note', { title: 'Note', notes: 'multi\nline "quoted"' }),
	]
	const items = []
	for (const item of inputs) {
		const id = uuid()
		const enc = encryptItem(vaultKey, id, item)
		await user.api.createItem({ id, wrappedKey: enc.wrappedKey, data: enc.data })
		items.push({ id, parsed: JSON.parse(JSON.stringify(parseItem(item))) })
	}

	Object.assign(seed, {
		server: BASE_URL,
		user: user.id,
		password: user.password,
		master: MASTER,
		items,
		folder: { id: folderId, name: 'Shared 📁' },
		editId: items[0]!.id,
		passkey: { itemId: items[1]!.id },
	})
	writeFileSync(join(dir, 'seed.json'), JSON.stringify(seed))
}, 120_000)

afterAll(async () => {
	if (dir) rmSync(dir, { recursive: true, force: true })
	if (user && !process.env.VPASS_KEEP_USERS) await deleteTestUser(user.id)
})

async function syncedItems() {
	const cache = new VaultCache()
	// The first request after the Swift run may hit a keep-alive connection the server already closed.
	cache.applySync(await user.api.sync(0).catch(() => user.api.sync(0)))
	return new Map([...cache.items.values()].map((r) => [r.id, decryptItem(vaultKey, r)]))
}

it('runs the Swift client against the seeded vault', () => {
	execFileSync('docker', [
		'run', '--rm', '--network', 'host',
		'-u', `${process.getuid!()}:${process.getgid!()}`,
		'-e', 'HOME=/tmp',
		'-e', 'VPASS_INTEROP=/interop/seed.json',
		'-v', `${KIT}:/pkg`, '-v', `${dir}:/interop`, '-w', '/pkg',
		'vpass-swift', 'swift', 'test', '--filter', 'InteropTests',
	], { stdio: 'inherit', timeout: 15 * 60_000 })
	output = JSON.parse(readFileSync(join(dir, 'swift-output.json'), 'utf8'))
}, 16 * 60_000)

it('decrypts everything Swift wrote with core', async () => {
	const items = await syncedItems()
	const created = items.get(output.createdId)!.item
	expect(created).toMatchObject({ type: 'login', title: 'Made on iPhone', username: 'swift@example.com', password: 'swïft-🔑', folderId: (seed.folder as { id: string }).id })
	expect(items.get(output.createdId)!.deletedAt).toBeNull()

	const edited = items.get(seed.editId as string)!.item as LoginItem & { futureField?: unknown }
	expect(edited.password).toBe('new-from-swift')
	expect(edited.notes).toBe('edited on iPhone')
	expect(edited.passwordHistory[0]?.password).toBe('original-password')
	expect(edited.passwordChangedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
	expect(edited.futureField).toEqual({ keep: ['me', 1] })
	expect(edited.customFields).toEqual([{ label: 'Security answer', type: 'hidden', value: 'blue' }])
	expect(edited.totp).toBe('JBSWY3DPEHPK3PXP')
})

it('accepts a Swift-made passkey at registration and with core as the authenticator', async () => {
	const reg = output.registration
	const registration = await verifyRegistrationResponse({
		response: {
			id: reg.id, rawId: reg.id, type: 'public-key',
			response: { clientDataJSON: reg.clientDataJSON, attestationObject: reg.attestationObject, transports: ['internal'] },
			clientExtensionResults: {},
		} as unknown as SwaRegistrationResponse,
		expectedChallenge: reg.challenge,
		expectedOrigin: ORIGIN,
		expectedRPID: RP_ID,
		requireUserVerification: true,
	})
	expect(registration.verified).toBe(true)
	expect(registration.registrationInfo!.aaguid).toBe('ba7969c9-c736-4440-86e6-a7d983855a46')
	expect(registration.registrationInfo!.credentialBackedUp).toBe(true)

	// The PKCS#8 key Swift stored signs in core (the browser extension's authenticator).
	const items = await syncedItems()
	const passkey = (items.get(output.passkeyItemId)!.item as LoginItem).passkeys[0]!
	expect(passkey).toMatchObject({ rpId: RP_ID, userName: 'swifty', algorithm: -7, signCount: 0 })
	const challenge = b64urlEncode(utf8Encode('core signs'))
	const assertion = await getAssertion({ challenge, rpId: RP_ID }, passkey, { origin: ORIGIN })
	const result = await verifyAuthenticationResponse({
		response: assertion as unknown as SwaAuthenticationResponse,
		expectedChallenge: challenge,
		expectedOrigin: ORIGIN,
		expectedRPID: RP_ID,
		credential: registration.registrationInfo!.credential,
		requireUserVerification: true,
	})
	expect(result.verified).toBe(true)
})

it('accepts a Swift assertion made with a core-made passkey', async () => {
	const a = output.assertion
	const result = await verifyAuthenticationResponse({
		response: {
			id: a.id, rawId: a.id, type: 'public-key',
			response: { clientDataJSON: a.clientDataJSON, authenticatorData: a.authenticatorData, signature: a.signature, userHandle: a.userHandle },
			clientExtensionResults: {},
		} as unknown as SwaAuthenticationResponse,
		expectedChallenge: a.challenge,
		expectedOrigin: ORIGIN,
		expectedRPID: RP_ID,
		credential: tsCredential,
		requireUserVerification: true,
	})
	expect(result.verified).toBe(true)
	expect(result.authenticationInfo.newCounter).toBe(0)
})
