import { DEFAULT_PASSPHRASE_OPTIONS, DEFAULT_PASSWORD_OPTIONS, type PassphraseOptions, type PasswordOptions } from '@vpass/core'

/** Same shape the web app stores under `vpass:generator`. */
export interface GeneratorSettings {
	mode: 'password' | 'passphrase'
	password: PasswordOptions
	passphrase: PassphraseOptions
}

/** User preferences, kept in chrome.storage.local. Nothing secret lives here. */
export interface Settings {
	/** Lock after this many idle minutes (0 = only when Chrome closes). Ignored while "keep unlocked" is on. */
	autoLockMinutes: number
	/** Lock when the computer locks or goes to sleep. Ignored while "keep unlocked" is on. */
	lockOnSystemLock: boolean
	/** Clear the clipboard this many seconds after copying a secret (0 = never). */
	clipboardClearSeconds: number
	/** Show the V-Pass icon and menu inside login, card and address fields. */
	inlineMenu: boolean
	/** Offer to save new logins and update changed passwords. */
	offerToSave: boolean
	/** Answer websites' passkey requests from the vault. */
	passkeyProvider: boolean
	generator: GeneratorSettings
}

export const DEFAULT_SETTINGS: Settings = {
	autoLockMinutes: 15,
	lockOnSystemLock: true,
	clipboardClearSeconds: 30,
	inlineMenu: true,
	offerToSave: true,
	passkeyProvider: true,
	generator: { mode: 'password', password: { ...DEFAULT_PASSWORD_OPTIONS }, passphrase: { ...DEFAULT_PASSPHRASE_OPTIONS } },
}

export function withDefaults(stored: Partial<Settings> | undefined): Settings {
	return {
		...DEFAULT_SETTINGS,
		...stored,
		generator: {
			...DEFAULT_SETTINGS.generator,
			...stored?.generator,
			password: { ...DEFAULT_SETTINGS.generator.password, ...stored?.generator?.password },
			passphrase: { ...DEFAULT_SETTINGS.generator.passphrase, ...stored?.generator?.passphrase },
		},
	}
}
