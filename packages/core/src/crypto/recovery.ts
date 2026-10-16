import { base32Decode, base32Encode, bytesEqual, concatBytes } from './encoding.ts'
import { InvalidRecoveryKeyError } from './errors.ts'
import { KEY_BYTES } from './keys.ts'
import { randomBytes } from './random.ts'
import { na } from './sodium.ts'

/**
 * Recovery key = 32 random bytes + 3-byte BLAKE2b checksum (35 bytes)
 * → 56 base32 characters, shown as 14 groups of 4: `ABCD-EFGH-…`.
 * The checksum lets us tell the user "typo" instead of "wrong key".
 */
const CHECKSUM_BYTES = 3
const GROUP = 4

function checksum(secret: Uint8Array): Uint8Array {
	return na().crypto_generichash(16, secret, null).subarray(0, CHECKSUM_BYTES)
}

export function generateRecoveryKey(): { secret: Uint8Array, formatted: string } {
	const secret = randomBytes(KEY_BYTES)
	return { secret, formatted: formatRecoveryKey(secret) }
}

export function formatRecoveryKey(secret: Uint8Array): string {
	const encoded = base32Encode(concatBytes(secret, checksum(secret)))
	return encoded.match(new RegExp(`.{1,${GROUP}}`, 'g'))!.join('-')
}

/** Parse what the user typed or pasted. Tolerates case, spaces, dashes and 0/1/8 look-alikes. */
export function parseRecoveryKey(input: string): Uint8Array {
	const normalised = input
		.toUpperCase()
		.replace(/[\s-]/g, '')
		.replace(/0/g, 'O')
		.replace(/1/g, 'I')
		.replace(/8/g, 'B')
	if (!/^[A-Z2-7]{56}$/.test(normalised)) {
		throw new InvalidRecoveryKeyError('format')
	}
	const bytes = base32Decode(normalised)
	const secret = bytes.subarray(0, KEY_BYTES)
	if (!bytesEqual(bytes.subarray(KEY_BYTES), checksum(secret))) {
		throw new InvalidRecoveryKeyError('checksum')
	}
	return secret.slice()
}
