import { parse } from 'tldts'

/**
 * Errors named like the DOMExceptions WebAuthn raises, so the page-side shim can
 * rethrow them as `new DOMException(message, name)`.
 */
export type WebAuthnErrorName = 'NotAllowedError' | 'SecurityError' | 'NotSupportedError' | 'InvalidStateError' | 'AbortError'

export class WebAuthnError extends Error {
	constructor(public readonly domName: WebAuthnErrorName, message: string) {
		super(message)
		this.name = 'WebAuthnError'
	}
}

function isLocalhost(hostname: string): boolean {
	return hostname === 'localhost' || hostname.endsWith('.localhost')
}

/** A secure context in WebAuthn's sense: https, or http on localhost. */
export function isWebAuthnOrigin(origin: string): boolean {
	try {
		const url = new URL(origin)
		return url.protocol === 'https:' || (url.protocol === 'http:' && isLocalhost(url.hostname))
	} catch {
		return false
	}
}

/**
 * The RP ID a request uses: the explicit one, or the caller's host.
 * Throws SecurityError unless the RP ID is the origin's host or a registrable
 * parent of it. Public suffixes (`com`, `co.uk`, `github.io`) and IP addresses
 * are never valid RP IDs.
 */
export function resolveRpId(origin: string, requested?: string | null): string {
	if (!isWebAuthnOrigin(origin)) {
		throw new WebAuthnError('SecurityError', 'Passkeys need a secure (https) page')
	}
	const host = new URL(origin).hostname.toLowerCase()
	const rpId = (requested ?? host).trim().toLowerCase()
	if (!rpId || rpId.startsWith('.') || rpId.endsWith('.')) {
		throw new WebAuthnError('SecurityError', `Invalid relying party ID "${rpId}"`)
	}
	if (rpId !== host && !host.endsWith(`.${rpId}`)) {
		throw new WebAuthnError('SecurityError', `"${rpId}" is not a valid relying party ID for ${host}`)
	}
	if (isLocalhost(rpId)) {
		return rpId
	}
	const info = parse(rpId, { allowPrivateDomains: true })
	if (info.isIp) {
		throw new WebAuthnError('SecurityError', 'IP addresses cannot be relying party IDs')
	}
	if (!info.domain || info.publicSuffix === rpId) {
		throw new WebAuthnError('SecurityError', `"${rpId}" is a public suffix and cannot be a relying party ID`)
	}
	return rpId
}
