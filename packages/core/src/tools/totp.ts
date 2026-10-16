import { base32Decode, base32Encode } from '../crypto/encoding.ts'

/** Time-based one-time passwords (RFC 6238 / RFC 4226) using WebCrypto HMAC. */

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'

export interface TotpParams {
	secret: Uint8Array
	algorithm: TotpAlgorithm
	digits: number
	period: number
	issuer: string
	account: string
}

export class InvalidTotpError extends Error {
	constructor(message = 'Not a valid authenticator key or otpauth:// link') {
		super(message)
		this.name = 'InvalidTotpError'
	}
}

/** Accepts an `otpauth://totp/...` URI or a bare base32 secret (spaces allowed). */
export function parseTotp(input: string): TotpParams {
	const value = input.trim()
	if (!value) {
		throw new InvalidTotpError('Empty authenticator key')
	}
	if (/^otpauth:\/\//i.test(value)) {
		return parseOtpauthUri(value)
	}
	return { secret: decodeSecret(value), algorithm: 'SHA1', digits: 6, period: 30, issuer: '', account: '' }
}

function decodeSecret(value: string): Uint8Array {
	try {
		const secret = base32Decode(value)
		if (secret.length < 5) {
			throw new InvalidTotpError('Authenticator key is too short')
		}
		return secret
	} catch (e) {
		throw e instanceof InvalidTotpError ? e : new InvalidTotpError()
	}
}

function parseOtpauthUri(uri: string): TotpParams {
	let url: URL
	try {
		url = new URL(uri)
	} catch {
		throw new InvalidTotpError()
	}
	if (url.host.toLowerCase() !== 'totp') {
		throw new InvalidTotpError('Only time-based (TOTP) codes are supported')
	}
	const secret = url.searchParams.get('secret')
	if (!secret) {
		throw new InvalidTotpError('The link has no secret')
	}
	const label = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
	const [labelIssuer, labelAccount] = label.includes(':') ? label.split(/:(.*)/s) : ['', label]
	const algorithm = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase()
	const digits = Number(url.searchParams.get('digits') ?? 6)
	const period = Number(url.searchParams.get('period') ?? 30)
	if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm)) {
		throw new InvalidTotpError(`Unsupported algorithm ${algorithm}`)
	}
	if (![6, 7, 8].includes(digits) || !Number.isInteger(period) || period < 1 || period > 300) {
		throw new InvalidTotpError('Unsupported digits or period')
	}
	return {
		secret: decodeSecret(secret),
		algorithm: algorithm as TotpAlgorithm,
		digits,
		period,
		issuer: url.searchParams.get('issuer') ?? labelIssuer ?? '',
		account: (labelAccount ?? '').trim(),
	}
}

export function buildOtpauthUri(params: TotpParams): string {
	const label = encodeURIComponent(params.issuer ? `${params.issuer}:${params.account}` : params.account)
	const query = new URLSearchParams({ secret: base32Encode(params.secret) })
	if (params.issuer) query.set('issuer', params.issuer)
	if (params.algorithm !== 'SHA1') query.set('algorithm', params.algorithm)
	if (params.digits !== 6) query.set('digits', String(params.digits))
	if (params.period !== 30) query.set('period', String(params.period))
	return `otpauth://totp/${label}?${query.toString()}`
}

const HASH: Record<TotpAlgorithm, string> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }

export async function hotp(secret: Uint8Array, counter: number, algorithm: TotpAlgorithm = 'SHA1', digits = 6): Promise<string> {
	const key = await globalThis.crypto.subtle.importKey('raw', secret as BufferSource, { name: 'HMAC', hash: HASH[algorithm] }, false, ['sign'])
	const msg = new DataView(new ArrayBuffer(8))
	msg.setUint32(0, Math.floor(counter / 2 ** 32))
	msg.setUint32(4, counter >>> 0)
	const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, msg.buffer))
	const offset = mac[mac.length - 1]! & 0x0f
	const binary = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!
	return String(binary % 10 ** digits).padStart(digits, '0')
}

export interface TotpCode {
	code: string
	/** Seconds until this code expires. */
	remaining: number
	period: number
}

export async function totpCode(params: TotpParams, nowMs = Date.now()): Promise<TotpCode> {
	const seconds = Math.floor(nowMs / 1000)
	const counter = Math.floor(seconds / params.period)
	return {
		code: await hotp(params.secret, counter, params.algorithm, params.digits),
		remaining: params.period - (seconds % params.period),
		period: params.period,
	}
}

export function formatTotpCode(code: string): string {
	return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code
}
