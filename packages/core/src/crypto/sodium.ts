import sodium from 'libsodium-wrappers-sumo'

let readyPromise: Promise<void> | null = null
let ready = false

/**
 * Load libsodium (WASM). Must be awaited once before any other crypto call.
 * Safe to call repeatedly.
 */
export function initCrypto(): Promise<void> {
	readyPromise ??= sodium.ready.then(() => {
		ready = true
	})
	return readyPromise
}

/** Synchronous access to the initialised libsodium instance. */
export function na(): typeof sodium {
	if (!ready) {
		throw new Error('V-Pass crypto is not initialised: await initCrypto() first')
	}
	return sodium
}
