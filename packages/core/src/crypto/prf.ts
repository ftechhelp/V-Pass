import { b64urlEncode } from './encoding.ts'
import { DecryptionError } from './errors.ts'
import { AAD, KDF_CONTEXT, deriveSubkey, unwrapKey, wipe, wrapKey } from './keys.ts'
import { randomBytes } from './random.ts'

/**
 * Passkey unlock via the WebAuthn PRF extension.
 *
 * The authenticator computes HMAC(secret-on-device, prfSalt) and returns 32 bytes
 * only after user verification. We derive a wrapping key from that output and
 * store VK wrapped under it. The server never sees the PRF output.
 */
export function newPrfSalt(): string {
	return b64urlEncode(randomBytes(32))
}

function prfWrappingKey(prfOutput: Uint8Array): Uint8Array {
	if (prfOutput.length !== 32) {
		throw new RangeError('PRF output must be 32 bytes')
	}
	return deriveSubkey(prfOutput, KDF_CONTEXT.prf)
}

export function wrapVaultKeyWithPrf(vaultKey: Uint8Array, prfOutput: Uint8Array, credentialId: string): string {
	const key = prfWrappingKey(prfOutput)
	try {
		return wrapKey(key, vaultKey, AAD.vaultKeyPrf(credentialId))
	} finally {
		wipe(key)
	}
}

export function unwrapVaultKeyWithPrf(wrapped: string, prfOutput: Uint8Array, credentialId: string): Uint8Array {
	const key = prfWrappingKey(prfOutput)
	try {
		return unwrapKey(key, wrapped, AAD.vaultKeyPrf(credentialId))
	} catch (e) {
		if (e instanceof DecryptionError) {
			throw new DecryptionError('This passkey could not unlock the vault')
		}
		throw e
	} finally {
		wipe(key)
	}
}
