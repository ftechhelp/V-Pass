/** Ciphertext failed authentication: wrong key, tampered data, or mismatched AAD. */
export class DecryptionError extends Error {
	constructor(message = 'Decryption failed') {
		super(message)
		this.name = 'DecryptionError'
	}
}

export class WrongPasswordError extends Error {
	constructor() {
		super('Incorrect master password')
		this.name = 'WrongPasswordError'
	}
}

export class InvalidRecoveryKeyError extends Error {
	constructor(public readonly reason: 'format' | 'checksum' | 'mismatch') {
		super(reason === 'mismatch'
			? 'This recovery key does not belong to this vault'
			: 'This recovery key is not valid. Check it for typos.')
		this.name = 'InvalidRecoveryKeyError'
	}
}

export class EncodingError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'EncodingError'
	}
}
