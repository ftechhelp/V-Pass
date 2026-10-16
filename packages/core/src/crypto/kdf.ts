import { b64urlDecode, b64urlEncode } from './encoding.ts'
import { randomBytes } from './random.ts'
import { na } from './sodium.ts'

/** Argon2id parameters, stored (in the clear) with the vault so they can be raised later. */
export interface KdfParams {
	algorithm: 'argon2id'
	/** Iterations (libsodium opslimit). */
	opsLimit: number
	/** Memory in bytes (libsodium memlimit). */
	memLimit: number
	/** 16-byte salt, base64url. */
	salt: string
}

export const DEFAULT_KDF_OPS = 3
export const DEFAULT_KDF_MEM = 64 * 1024 * 1024

const MIN_OPS = 2
const MAX_OPS = 20
const MIN_MEM = 32 * 1024 * 1024
const MAX_MEM = 1024 * 1024 * 1024

export function newKdfParams(opsLimit = DEFAULT_KDF_OPS, memLimit = DEFAULT_KDF_MEM): KdfParams {
	const params: KdfParams = {
		algorithm: 'argon2id',
		opsLimit,
		memLimit,
		salt: b64urlEncode(randomBytes(16)),
	}
	assertKdfParams(params)
	return params
}

export function assertKdfParams(params: KdfParams): void {
	if (params.algorithm !== 'argon2id') {
		throw new Error(`Unsupported KDF algorithm: ${String(params.algorithm)}`)
	}
	if (!Number.isInteger(params.opsLimit) || params.opsLimit < MIN_OPS || params.opsLimit > MAX_OPS) {
		throw new Error('KDF iterations out of range')
	}
	if (!Number.isInteger(params.memLimit) || params.memLimit < MIN_MEM || params.memLimit > MAX_MEM) {
		throw new Error('KDF memory out of range')
	}
	if (b64urlDecode(params.salt).length !== 16) {
		throw new Error('KDF salt must be 16 bytes')
	}
}

/**
 * Stretch the master password into a 32-byte master key with Argon2id.
 * The password is NFKC-normalised so the same password typed on different
 * keyboards/OSes always yields the same key. Blocks for a few hundred ms.
 */
export function deriveMasterKey(password: string, params: KdfParams): Uint8Array {
	assertKdfParams(params)
	const s = na()
	return s.crypto_pwhash(
		32,
		password.normalize('NFKC'),
		b64urlDecode(params.salt),
		params.opsLimit,
		params.memLimit,
		s.crypto_pwhash_ALG_ARGON2ID13,
	)
}
