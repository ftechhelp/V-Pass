import { randomInt } from '../crypto/random.ts'
import { EFF_LARGE_WORDLIST } from './eff-wordlist.ts'

export interface PasswordOptions {
	length: number
	lowercase: boolean
	uppercase: boolean
	digits: boolean
	symbols: boolean
	/** Leave out characters that are easy to confuse (Il1 O0 etc.). */
	avoidAmbiguous: boolean
}

export interface PassphraseOptions {
	words: number
	separator: string
	capitalize: boolean
	includeNumber: boolean
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
	length: 20,
	lowercase: true,
	uppercase: true,
	digits: true,
	symbols: true,
	avoidAmbiguous: false,
}

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
	words: 5,
	separator: '-',
	capitalize: true,
	includeNumber: true,
}

export const PASSWORD_LENGTH_RANGE = { min: 4, max: 128 } as const
export const PASSPHRASE_WORDS_RANGE = { min: 3, max: 20 } as const

const SETS = {
	lowercase: 'abcdefghijklmnopqrstuvwxyz',
	uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	digits: '0123456789',
	symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
} as const
const AMBIGUOUS = new Set('Il1O0o|`\'";:,.{}[]()/~'.split(''))

function activeSets(opts: PasswordOptions): string[] {
	return (Object.keys(SETS) as (keyof typeof SETS)[])
		.filter((name) => opts[name])
		.map((name) => opts.avoidAmbiguous ? [...SETS[name]].filter((c) => !AMBIGUOUS.has(c)).join('') : SETS[name])
}

/** Random password guaranteed to contain at least one character from each selected set. */
export function generatePassword(opts: PasswordOptions = DEFAULT_PASSWORD_OPTIONS): string {
	const sets = activeSets(opts)
	if (sets.length === 0) {
		throw new Error('Select at least one character type')
	}
	const length = Math.min(PASSWORD_LENGTH_RANGE.max, Math.max(PASSWORD_LENGTH_RANGE.min, Math.floor(opts.length), sets.length))
	const pool = sets.join('')
	// Rejection sampling keeps the output uniform over all valid passwords.
	for (;;) {
		let out = ''
		for (let i = 0; i < length; i++) {
			out += pool[randomInt(pool.length)]
		}
		if (sets.every((set) => [...out].some((c) => set.includes(c)))) {
			return out
		}
	}
}

export function generatePassphrase(opts: PassphraseOptions = DEFAULT_PASSPHRASE_OPTIONS): string {
	const count = Math.min(PASSPHRASE_WORDS_RANGE.max, Math.max(PASSPHRASE_WORDS_RANGE.min, Math.floor(opts.words)))
	const words = Array.from({ length: count }, () => {
		const word = EFF_LARGE_WORDLIST[randomInt(EFF_LARGE_WORDLIST.length)]!
		return opts.capitalize ? word.charAt(0).toUpperCase() + word.slice(1) : word
	})
	if (opts.includeNumber) {
		const i = randomInt(words.length)
		words[i] = `${words[i]}${randomInt(10)}`
	}
	return words.join(opts.separator)
}

/** Approximate entropy in bits, for the "strength" readout. */
export function passwordEntropyBits(opts: PasswordOptions): number {
	const pool = activeSets(opts).join('').length
	return pool ? Math.floor(Math.max(opts.length, 0) * Math.log2(pool)) : 0
}

export function passphraseEntropyBits(opts: PassphraseOptions): number {
	const perWord = Math.log2(EFF_LARGE_WORDLIST.length)
	return Math.floor(opts.words * perWord + (opts.includeNumber ? Math.log2(10 * opts.words) : 0))
}
