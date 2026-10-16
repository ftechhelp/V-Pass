import type { AuthenticationResponseJSON, AuthenticatorTransport as Transport, CreationOptionsJSON, RegistrationResponseJSON, RequestOptionsJSON } from '@vpass/core'
import type { Fido2Result } from '../shared/protocol.ts'
import { isVPassApp } from '../shared/vpass-app.ts'
import type { ContentReply, PageMessage } from './page-protocol.ts'

/**
 * Page-world WebAuthn shim (runs in the page's JS world at document_start,
 * before any page script). It wraps navigator.credentials.create/get so V-Pass
 * can answer passkey requests from the vault, and hands everything it does not
 * handle — or the user sends to "another device" — to the browser's own
 * implementation. It holds no secrets: requests go to the extension, and only
 * the final credential comes back.
 */
(() => {
	const FLAG = Symbol.for('vpass.webauthn-shim')
	const scope = window as unknown as Record<symbol, boolean>
	if (scope[FLAG] || !window.isSecureContext || typeof PublicKeyCredential === 'undefined' || !navigator.credentials || isVPassApp(location.pathname)) {
		return
	}
	scope[FLAG] = true

	// Keep our own references in case the page replaces globals later.
	const container = navigator.credentials
	const nativeCreate = container.create.bind(container)
	const nativeGet = container.get.bind(container)
	const { btoa, atob, setTimeout, clearTimeout, DOMException, AbortController } = window
	const define = Object.defineProperty
	const create = Object.create
	const PKC = PublicKeyCredential as unknown as Record<string, unknown>

	/** Extensions V-Pass's authenticator can't provide: the site really wants them, so let the browser answer. */
	const BROWSER_ONLY_EXTENSIONS = ['prf', 'largeBlob', 'hmacCreateSecret', 'hmacGetSecret', 'credBlob', 'getCredBlob', 'payment']
	const needsBrowser = (extensions: unknown) =>
		!!extensions && typeof extensions === 'object' && BROWSER_ONLY_EXTENSIONS.some((name) => name in extensions)

	/* ---------- messaging ---------- */

	const handlers = new Map<string, (reply: ContentReply) => void>()
	window.addEventListener('message', (event) => {
		const data = event.data as ContentReply | null
		if (event.source === window && data?.vpass === 'content' && typeof data.id === 'string') {
			handlers.get(data.id)?.(data)
		}
	})

	const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')
	const post = (message: PageMessage) => window.postMessage(message, '*')
	const abortError = (signal: AbortSignal) => signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')

	/** Send a request; resolves with the result, or "fallback" if V-Pass does not acknowledge it quickly. */
	function ask(message: PageMessage, signal?: AbortSignal | null): Promise<Fido2Result> {
		return new Promise((resolve, reject) => {
			const { id } = message
			let acked = false
			const timer = setTimeout(() => {
				if (!acked) {
					cleanup()
					resolve({ status: 'fallback' })
				}
			}, 2500)
			const onAbort = () => {
				cleanup()
				post({ vpass: 'page', kind: 'abort', id })
				reject(abortError(signal!))
			}
			const cleanup = () => {
				clearTimeout(timer)
				handlers.delete(id)
				signal?.removeEventListener('abort', onAbort)
			}
			handlers.set(id, (reply) => {
				if ('ack' in reply) {
					acked = true
					clearTimeout(timer)
				} else if ('result' in reply) {
					cleanup()
					resolve(reply.result)
				}
			})
			signal?.addEventListener('abort', onAbort, { once: true })
			post(message)
		})
	}

	let providerEnabled: Promise<boolean> | null = null
	function enabled(): Promise<boolean> {
		providerEnabled ??= new Promise((resolve) => {
			const id = newId()
			const timer = setTimeout(() => {
				handlers.delete(id)
				resolve(false)
			}, 1500)
			handlers.set(id, (reply) => {
				if ('enabled' in reply) {
					clearTimeout(timer)
					handlers.delete(id)
					resolve(reply.enabled)
				}
			})
			post({ vpass: 'page', kind: 'status', id })
		})
		return providerEnabled
	}

	/* ---------- encoding ---------- */

	function b64(data: BufferSource): string {
		const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
		let binary = ''
		for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
		return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
	}

	function unb64(text: string): ArrayBuffer {
		const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4))
		const bytes = new Uint8Array(binary.length)
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
		return bytes.buffer
	}

	function creationToJSON(pk: PublicKeyCredentialCreationOptions): CreationOptionsJSON {
		const selection = pk.authenticatorSelection
		return {
			rp: { id: pk.rp.id, name: pk.rp.name },
			user: { id: b64(pk.user.id), name: pk.user.name, displayName: pk.user.displayName },
			challenge: b64(pk.challenge),
			pubKeyCredParams: (pk.pubKeyCredParams ?? []).map((p) => ({ type: 'public-key', alg: p.alg })),
			timeout: pk.timeout,
			excludeCredentials: (pk.excludeCredentials ?? []).map((c) => ({ type: 'public-key', id: b64(c.id), transports: c.transports as Transport[] | undefined })),
			authenticatorSelection: selection && {
				authenticatorAttachment: selection.authenticatorAttachment,
				residentKey: selection.residentKey,
				requireResidentKey: selection.requireResidentKey,
				userVerification: selection.userVerification,
			},
			attestation: pk.attestation,
			extensions: (pk.extensions as { credProps?: boolean } | undefined)?.credProps ? { credProps: true } : undefined,
		}
	}

	function requestToJSON(pk: PublicKeyCredentialRequestOptions): RequestOptionsJSON {
		return {
			challenge: b64(pk.challenge),
			timeout: pk.timeout,
			rpId: pk.rpId,
			allowCredentials: (pk.allowCredentials ?? []).map((c) => ({ type: 'public-key', id: b64(c.id) })),
			userVerification: pk.userVerification,
		}
	}

	/* ---------- results ---------- */

	const value = (v: unknown) => ({ value: v, enumerable: true, configurable: true })
	const method = (fn: (...args: never[]) => unknown) => ({ value: fn, configurable: true, writable: true })

	/** A real-looking PublicKeyCredential (prototype chain intact) built from the JSON response. */
	function toCredential(json: RegistrationResponseJSON | AuthenticationResponseJSON): PublicKeyCredential {
		let response: AuthenticatorResponse
		if ('attestationObject' in json.response) {
			const r = json.response
			const authenticatorData = unb64(r.authenticatorData)
			const publicKey = unb64(r.publicKey)
			response = create(AuthenticatorAttestationResponse.prototype)
			define(response, 'clientDataJSON', value(unb64(r.clientDataJSON)))
			define(response, 'attestationObject', value(unb64(r.attestationObject)))
			define(response, 'getTransports', method(() => [...r.transports]))
			define(response, 'getAuthenticatorData', method(() => authenticatorData))
			define(response, 'getPublicKey', method(() => publicKey))
			define(response, 'getPublicKeyAlgorithm', method(() => r.publicKeyAlgorithm))
		} else {
			const r = (json as AuthenticationResponseJSON).response
			response = create(AuthenticatorAssertionResponse.prototype)
			define(response, 'clientDataJSON', value(unb64(r.clientDataJSON)))
			define(response, 'authenticatorData', value(unb64(r.authenticatorData)))
			define(response, 'signature', value(unb64(r.signature)))
			define(response, 'userHandle', value(r.userHandle ? unb64(r.userHandle) : null))
		}
		const credential = create(PublicKeyCredential.prototype) as PublicKeyCredential
		define(credential, 'id', value(json.id))
		define(credential, 'rawId', value(unb64(json.rawId)))
		define(credential, 'type', value('public-key'))
		define(credential, 'authenticatorAttachment', value(json.authenticatorAttachment))
		define(credential, 'response', value(response))
		define(credential, 'getClientExtensionResults', method(() => JSON.parse(JSON.stringify(json.clientExtensionResults))))
		define(credential, 'toJSON', method(() => JSON.parse(JSON.stringify(json))))
		return credential
	}

	function settle(result: Fido2Result, native: () => Promise<Credential | null>): Promise<Credential | null> {
		if (result.status === 'ok') {
			return Promise.resolve(toCredential(result.response))
		}
		if (result.status === 'fallback') {
			return native()
		}
		return Promise.reject(new DOMException(result.message, result.name))
	}

	/* ---------- navigator.credentials ---------- */

	async function vpassCreate(options: CredentialCreationOptions): Promise<Credential | null> {
		const signal = options.signal
		if (signal?.aborted) {
			throw abortError(signal)
		}
		let json: CreationOptionsJSON
		try {
			json = creationToJSON(options.publicKey!)
		} catch {
			return nativeCreate(options)
		}
		const result = await ask({ vpass: 'page', kind: 'create', id: newId(), options: json }, signal)
		return settle(result, () => nativeCreate(options))
	}

	async function vpassGet(options: CredentialRequestOptions): Promise<Credential | null> {
		const signal = options.signal
		if (signal?.aborted) {
			throw abortError(signal)
		}
		let json: RequestOptionsJSON
		try {
			json = requestToJSON(options.publicKey!)
		} catch {
			return nativeGet(options)
		}
		if (options.mediation === 'conditional') {
			return conditionalGet(options, json)
		}
		const result = await ask({ vpass: 'page', kind: 'get', id: newId(), options: json }, signal)
		return settle(result, () => nativeGet(options))
	}

	/**
	 * Passkey autofill: V-Pass's passkeys appear in its inline menu while Chrome's
	 * own autofill keeps running; whichever the user picks first wins.
	 */
	function conditionalGet(options: CredentialRequestOptions, json: RequestOptionsJSON): Promise<Credential | null> {
		const id = newId()
		const outer = options.signal
		const inner = new AbortController()
		return new Promise((resolve, reject) => {
			let done = false
			const finish = (fn: () => void) => {
				if (done) return
				done = true
				handlers.delete(id)
				outer?.removeEventListener('abort', onAbort)
				fn()
			}
			const onAbort = () => finish(() => {
				inner.abort(outer!.reason)
				post({ vpass: 'page', kind: 'abort', id })
				reject(abortError(outer!))
			})
			outer?.addEventListener('abort', onAbort, { once: true })
			handlers.set(id, (reply) => {
				if (!('result' in reply)) return
				const result = reply.result
				finish(() => {
					inner.abort(new DOMException('Answered by V-Pass', 'AbortError'))
					if (result.status === 'ok') resolve(toCredential(result.response))
					else if (result.status === 'error') reject(new DOMException(result.message, result.name))
				})
			})
			post({ vpass: 'page', kind: 'conditional', id, options: json })
			nativeGet({ ...options, signal: inner.signal }).then(
				(credential) => finish(() => {
					post({ vpass: 'page', kind: 'abort', id })
					resolve(credential)
				}),
				(error) => {
					// Our own abort, or no native autofill: keep waiting for V-Pass.
					if (!inner.signal.aborted && error?.name !== 'AbortError' && error?.name !== 'NotAllowedError') {
						finish(() => reject(error))
					}
				},
			)
		})
	}

	define(container, 'create', method(function create(options?: CredentialCreationOptions) {
		if (!options?.publicKey || (options as { mediation?: string }).mediation === 'conditional' || needsBrowser(options.publicKey.extensions)) {
			return nativeCreate(options)
		}
		return vpassCreate(options)
	}))

	define(container, 'get', method(function get(options?: CredentialRequestOptions) {
		if (!options?.publicKey || needsBrowser(options.publicKey.extensions)) {
			return nativeGet(options)
		}
		return vpassGet(options)
	}))

	/* ---------- capability checks ---------- */

	const wrapCheck = (name: string) => {
		const native = typeof PKC[name] === 'function' ? (PKC[name] as () => Promise<boolean>).bind(PublicKeyCredential) : null
		define(PublicKeyCredential, name, method(async () => (await enabled()) || (native ? native() : false)))
	}
	wrapCheck('isUserVerifyingPlatformAuthenticatorAvailable')
	wrapCheck('isConditionalMediationAvailable')
	if (typeof PKC.getClientCapabilities === 'function') {
		const native = (PKC.getClientCapabilities as () => Promise<Record<string, boolean>>).bind(PublicKeyCredential)
		define(PublicKeyCredential, 'getClientCapabilities', method(async () => {
			const caps = await native()
			return (await enabled()) ? { ...caps, conditionalGet: true, passkeyPlatformAuthenticator: true, userVerifyingPlatformAuthenticator: true } : caps
		}))
	}
})()
