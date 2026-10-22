import { base32Decode } from '@vpass/core'
import { migrationLink } from '../../packages/core/test/helpers/google-authenticator.ts'

/** Keys of the codes the web app's import test moves over from other apps. */
export const IMPORT_KEYS = { bank: 'KRSXG5CTMVRXEZLU', exampleOrg: 'ONSWG4TFOQYTEMZU', northwind: 'MZXW6YTBOJRGC6TB', woodgrove: 'NFXGQ2LOM5RW65LU' }

/**
 * A two-code Google Authenticator export. The browser's fake camera shows code 1
 * (playwright.config.ts): GitHub's key (already in the vault by then) and the
 * NordPass fixture's Bank login. Code 2 is a screenshot.
 */
export const GOOGLE_EXPORT = [
	migrationLink([
		{ secret: base32Decode('JBSWY3DPEHPK3PXP'), name: 'GitHub:alice@example.com', issuer: 'GitHub' },
		{ secret: base32Decode(IMPORT_KEYS.bank), name: 'carol', issuer: 'Bank' },
	], { size: 2, index: 0, id: 815 }),
	migrationLink([{ secret: base32Decode(IMPORT_KEYS.exampleOrg), name: 'bob', issuer: 'example.org' }], { size: 2, index: 1, id: 815 }),
]
