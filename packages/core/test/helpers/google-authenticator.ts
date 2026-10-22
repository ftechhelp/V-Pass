/**
 * Builds Google Authenticator "Transfer accounts" links (otpauth-migration://)
 * for tests, the iOS vectors and the end-to-end suites. V-Pass itself only
 * reads them.
 */

export interface MigrationAccount {
	secret: Uint8Array
	name: string
	issuer?: string
	/** 1 SHA1, 2 SHA256, 3 SHA512, 4 MD5 */
	algorithm?: number
	/** 1 six, 2 eight */
	digits?: number
	/** 1 HOTP, 2 TOTP */
	type?: number
	counter?: number
}

function varint(value: number | bigint): number[] {
	let n = BigInt.asUintN(64, BigInt(value))
	const out: number[] = []
	do {
		const byte = Number(n & 0x7fn)
		n >>= 7n
		out.push(n ? byte | 0x80 : byte)
	} while (n)
	return out
}

const key = (field: number, wire: number) => varint((field << 3) | wire)
const bytesField = (field: number, bytes: Uint8Array | number[]) => [...key(field, 2), ...varint(bytes.length), ...bytes]
const intField = (field: number, value: number) => [...key(field, 0), ...varint(value)]

export function migrationPayload(accounts: MigrationAccount[], batch = { size: 1, index: 0, id: 123456789 }): Uint8Array {
	const out: number[] = []
	for (const account of accounts) {
		const params = [
			...bytesField(1, account.secret),
			...bytesField(2, [...new TextEncoder().encode(account.name)]),
			...(account.issuer !== undefined ? bytesField(3, [...new TextEncoder().encode(account.issuer)]) : []),
			...intField(4, account.algorithm ?? 1),
			...intField(5, account.digits ?? 1),
			...intField(6, account.type ?? 2),
			...(account.counter !== undefined ? intField(7, account.counter) : []),
		]
		out.push(...bytesField(1, params))
	}
	out.push(...intField(2, 1), ...intField(3, batch.size), ...intField(4, batch.index), ...intField(5, batch.id))
	return Uint8Array.from(out)
}

/** The link as the app's QR code holds it: standard base64, percent-encoded. */
export function migrationLink(accounts: MigrationAccount[], batch?: { size: number, index: number, id: number }): string {
	const base64 = Buffer.from(migrationPayload(accounts, batch)).toString('base64')
	return `otpauth-migration://offline?data=${encodeURIComponent(base64)}`
}
