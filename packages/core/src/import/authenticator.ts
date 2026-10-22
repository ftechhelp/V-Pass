import { b64urlDecode, base32Encode, utf8Decode } from '../crypto/encoding.ts'
import { type Item, type LoginItem, newItem } from '../model/items.ts'
import { InvalidTotpError, type TotpAlgorithm, type TotpFields, type TotpParams, buildOtpauthUri, parseTotp, totpParamsFrom } from '../tools/totp.ts'
import { registrableDomain } from '../tools/url-match.ts'

/**
 * Moving one-time codes over from other authenticator apps, on the device:
 * Google Authenticator's export QR codes (otpauth-migration://), lists of
 * otpauth:// links (Ente Auth's export and most other apps), and the
 * unencrypted JSON exports of Aegis, 2FAS and Bitwarden Authenticator.
 * Microsoft Authenticator has no export, so there is nothing to read from it.
 */

/** One code from another app. */
export interface AuthenticatorEntry {
	/** The code as an otpauth://totp/… link, which is what a login's `totp` stores. */
	totp: string
	issuer: string
	account: string
}

/** A code V-Pass can't use (counter-based, Steam…). Listed so nothing disappears silently. */
export interface SkippedAuthenticatorEntry {
	issuer: string
	account: string
	reason: string
}

/** Google Authenticator splits large exports over several QR codes: this one is number `index + 1` of `size`. */
export interface AuthenticatorBatch {
	id: number
	index: number
	size: number
}

export type AuthenticatorFormat = 'google-authenticator' | 'otpauth' | 'aegis' | '2fas' | 'bitwarden'

export interface AuthenticatorExport {
	format: AuthenticatorFormat
	entries: AuthenticatorEntry[]
	skipped: SkippedAuthenticatorEntry[]
	batches: AuthenticatorBatch[]
}

export class InvalidAuthenticatorExportError extends Error {
	constructor(message = 'This isn\'t an export from an authenticator app') {
		super(message)
		this.name = 'InvalidAuthenticatorExportError'
	}
}

const DAMAGED = 'This Google Authenticator code can\'t be read. Scan it again.'
const COUNTER_BASED = 'Counter-based (HOTP) codes aren\'t supported'
const STEAM = 'Steam Guard codes aren\'t supported'
const OTHER_KIND = 'This kind of code isn\'t supported'

const encrypted = (app: string) => new InvalidAuthenticatorExportError(`This ${app} export is encrypted. Export it again without a password, import that file, then delete it.`)

/** Whether the text is one of Google Authenticator's "Transfer accounts" QR codes. */
export function isGoogleAuthenticatorExport(text: string): boolean {
	return /^\s*otpauth-migration:\/\//i.test(text)
}

/** Read a scanned QR code, pasted text or exported file. Throws InvalidAuthenticatorExportError. */
export function parseAuthenticatorExport(text: string): AuthenticatorExport {
	const value = text.replace(/^﻿/, '').trim()
	if (value.startsWith('{')) {
		let json: unknown
		try {
			json = JSON.parse(value)
		} catch {
			throw new InvalidAuthenticatorExportError()
		}
		return parseJsonExport(json)
	}
	const links = value.match(/otpauth(?:-migration)?:\/\/[^\s"'<>]+/gi)
	if (!links) {
		throw new InvalidAuthenticatorExportError()
	}
	const result: AuthenticatorExport = { format: 'otpauth', entries: [], skipped: [], batches: [] }
	for (const link of links) {
		if (isGoogleAuthenticatorExport(link)) {
			result.format = 'google-authenticator'
			readMigrationLink(link, result)
		} else {
			readOtpauthLink(link, result)
		}
	}
	return result
}

function entryFrom(params: TotpParams): AuthenticatorEntry {
	const issuer = params.issuer.trim()
	const account = params.account.trim()
	return { totp: buildOtpauthUri({ ...params, issuer, account }), issuer, account }
}

function readOtpauthLink(link: string, into: AuthenticatorExport): void {
	try {
		into.entries.push(entryFrom(parseTotp(link)))
	} catch (e) {
		if (!(e instanceof InvalidTotpError)) {
			throw e
		}
		into.skipped.push({ ...labelOf(link), reason: /^otpauth:\/\/hotp\//i.test(link) ? COUNTER_BASED : e.message })
	}
}

/** Issuer and account of a link that isn't usable, to say which one was skipped. */
function labelOf(link: string): { issuer: string, account: string } {
	try {
		const url = new URL(link)
		const label = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
		const [labelIssuer, labelAccount] = label.includes(':') ? label.split(/:(.*)/s) : ['', label]
		return { issuer: (url.searchParams.get('issuer') ?? labelIssuer ?? '').trim(), account: (labelAccount ?? '').trim() }
	} catch {
		return { issuer: '', account: '' }
	}
}

/* ---------- Google Authenticator (protobuf MigrationPayload) ---------- */

type ProtoValue = bigint | Uint8Array

/** The varint (wire type 0) and length-delimited (wire type 2) fields of a protobuf message, in order. */
function protoFields(bytes: Uint8Array): { field: number, value: ProtoValue }[] {
	const fields: { field: number, value: ProtoValue }[] = []
	let pos = 0
	const varint = (): bigint => {
		let result = 0n
		for (let shift = 0n; shift < 70n; shift += 7n) {
			const byte = bytes[pos++]
			if (byte === undefined) {
				break
			}
			result |= BigInt(byte & 0x7f) << shift
			if (!(byte & 0x80)) {
				return BigInt.asUintN(64, result)
			}
		}
		throw new InvalidAuthenticatorExportError(DAMAGED)
	}
	while (pos < bytes.length) {
		const key = varint()
		const field = Number(key >> 3n)
		switch (Number(key & 7n)) {
		case 0:
			fields.push({ field, value: varint() })
			break
		case 1:
			pos += 8
			break
		case 2: {
			const length = varint()
			if (length > BigInt(bytes.length - pos)) {
				throw new InvalidAuthenticatorExportError(DAMAGED)
			}
			fields.push({ field, value: bytes.subarray(pos, pos + Number(length)) })
			pos += Number(length)
			break
		}
		case 5:
			pos += 4
			break
		default:
			throw new InvalidAuthenticatorExportError(DAMAGED)
		}
		if (pos > bytes.length) {
			throw new InvalidAuthenticatorExportError(DAMAGED)
		}
	}
	return fields
}

const int32 = (value: ProtoValue) => typeof value === 'bigint' ? Number(BigInt.asIntN(32, value)) : 0

function protoText(value: ProtoValue): string {
	if (typeof value === 'bigint') {
		return ''
	}
	try {
		return utf8Decode(value)
	} catch {
		throw new InvalidAuthenticatorExportError(DAMAGED)
	}
}

/** Standard base64 as it arrives in the link's query (a "+" may have turned into a space). */
function base64Decode(text: string): Uint8Array {
	return b64urlDecode(text.replace(/ /g, '+').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))
}

function readMigrationLink(link: string, into: AuthenticatorExport): void {
	let payload: Uint8Array
	try {
		payload = base64Decode(new URL(link).searchParams.get('data') ?? '')
	} catch {
		throw new InvalidAuthenticatorExportError(DAMAGED)
	}
	const batch: AuthenticatorBatch = { id: 0, index: 0, size: 1 }
	for (const { field, value } of protoFields(payload)) {
		switch (field) {
		case 1:
			if (value instanceof Uint8Array) readMigrationEntry(value, into)
			break
		case 3:
			batch.size = Math.max(1, int32(value))
			break
		case 4:
			batch.index = int32(value)
			break
		case 5:
			batch.id = int32(value)
			break
		}
	}
	into.batches.push(batch)
}

const MIGRATION_ALGORITHMS: Record<number, TotpAlgorithm> = { 0: 'SHA1', 1: 'SHA1', 2: 'SHA256', 3: 'SHA512' }
const MIGRATION_DIGITS: Record<number, number> = { 0: 6, 1: 6, 2: 8 }

function readMigrationEntry(bytes: Uint8Array, into: AuthenticatorExport): void {
	let secret: Uint8Array = new Uint8Array()
	let name = ''
	let issuer = ''
	let algorithm = 0
	let digits = 0
	let type = 0
	for (const { field, value } of protoFields(bytes)) {
		switch (field) {
		case 1:
			if (value instanceof Uint8Array) secret = value
			break
		case 2:
			name = protoText(value)
			break
		case 3:
			issuer = protoText(value)
			break
		case 4:
			algorithm = int32(value)
			break
		case 5:
			digits = int32(value)
			break
		case 6:
			type = int32(value)
			break
		}
	}
	// The name is "Issuer:account" or just the account.
	issuer = issuer.trim()
	let account = name.trim()
	if (issuer && account.startsWith(`${issuer}:`)) {
		account = account.slice(issuer.length + 1).trim()
	} else if (!issuer && account.includes(':')) {
		const colon = account.indexOf(':')
		issuer = account.slice(0, colon).trim()
		account = account.slice(colon + 1).trim()
	}
	const who = { issuer, account }
	const algorithmName = MIGRATION_ALGORITHMS[algorithm]
	const digitCount = MIGRATION_DIGITS[digits]
	if (type === 1) {
		into.skipped.push({ ...who, reason: COUNTER_BASED })
	} else if (type !== 0 && type !== 2) {
		into.skipped.push({ ...who, reason: OTHER_KIND })
	} else if (!algorithmName) {
		into.skipped.push({ ...who, reason: algorithm === 4 ? 'MD5 codes aren\'t supported' : 'Unsupported algorithm' })
	} else if (!digitCount) {
		into.skipped.push({ ...who, reason: 'Unsupported digits or period' })
	} else if (secret.length < 5) {
		into.skipped.push({ ...who, reason: 'Authenticator key is too short' })
	} else {
		into.entries.push(entryFrom({ secret: Uint8Array.from(secret), algorithm: algorithmName, digits: digitCount, period: 30, issuer, account }))
	}
}

/* ---------- JSON exports ---------- */

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
/** Numbers may arrive as JSON numbers or strings; anything else is NaN, which the TOTP checks refuse. */
const number = (value: unknown): number | undefined => {
	if (value === undefined || value === null || value === '') return undefined
	if (typeof value === 'number') return value
	return typeof value === 'string' ? Number(value.trim() || Number.NaN) : Number.NaN
}

function parseJsonExport(json: unknown): AuthenticatorExport {
	const root = object(json)
	if ('db' in root && 'header' in root) {
		return parseAegis(root)
	}
	if ('services' in root || 'servicesEncrypted' in root) {
		return parseTwoFas(root)
	}
	if (Array.isArray(root.items)) {
		return parseBitwarden(root)
	}
	throw new InvalidAuthenticatorExportError()
}

function addFields(into: AuthenticatorExport, type: string, fields: TotpFields & { issuer: string, account: string }): void {
	const who = { issuer: fields.issuer, account: fields.account }
	if (type === 'hotp') {
		into.skipped.push({ ...who, reason: COUNTER_BASED })
	} else if (type === 'steam') {
		into.skipped.push({ ...who, reason: STEAM })
	} else if (type !== 'totp') {
		into.skipped.push({ ...who, reason: OTHER_KIND })
	} else {
		try {
			into.entries.push(entryFrom(totpParamsFrom(fields)))
		} catch (e) {
			if (!(e instanceof InvalidTotpError)) {
				throw e
			}
			into.skipped.push({ ...who, reason: e.message })
		}
	}
}

/** Aegis: `{ version, header: { slots, params }, db: { entries: [...] } }`; `db` is a string when encrypted. */
function parseAegis(root: Record<string, unknown>): AuthenticatorExport {
	if (typeof root.db === 'string') {
		throw encrypted('Aegis')
	}
	const result: AuthenticatorExport = { format: 'aegis', entries: [], skipped: [], batches: [] }
	for (const raw of list(object(root.db).entries)) {
		const entry = object(raw)
		const info = object(entry.info)
		addFields(result, text(entry.type).toLowerCase() || 'totp', {
			secret: text(info.secret),
			algorithm: text(info.algo) || undefined,
			digits: number(info.digits),
			period: number(info.period),
			issuer: text(entry.issuer),
			account: text(entry.name),
		})
	}
	return result
}

/** 2FAS: `{ services: [{ name, secret, otp: { issuer, account, digits, period, algorithm, tokenType } }] }`. */
function parseTwoFas(root: Record<string, unknown>): AuthenticatorExport {
	const services = list(root.services)
	if (!services.length && text(root.servicesEncrypted)) {
		throw encrypted('2FAS')
	}
	const result: AuthenticatorExport = { format: '2fas', entries: [], skipped: [], batches: [] }
	for (const raw of services) {
		const service = object(raw)
		const otp = object(service.otp)
		addFields(result, (text(otp.tokenType) || 'TOTP').toLowerCase(), {
			secret: text(service.secret),
			algorithm: text(otp.algorithm) || undefined,
			digits: number(otp.digits),
			period: number(otp.period),
			issuer: text(otp.issuer) || text(service.name),
			account: text(otp.account) || text(otp.label),
		})
	}
	return result
}

/** Bitwarden (Authenticator, or a password manager export): `{ encrypted, items: [{ name, login: { username, totp } }] }`. */
function parseBitwarden(root: Record<string, unknown>): AuthenticatorExport {
	if (root.encrypted === true) {
		throw encrypted('Bitwarden')
	}
	const result: AuthenticatorExport = { format: 'bitwarden', entries: [], skipped: [], batches: [] }
	for (const raw of list(root.items)) {
		const item = object(raw)
		const login = object(item.login)
		const totp = text(login.totp)
		if (!totp) {
			continue
		}
		const who = { issuer: text(item.name), account: text(login.username) }
		if (/^steam:\/\//i.test(totp)) {
			result.skipped.push({ ...who, reason: STEAM })
			continue
		}
		try {
			const params = parseTotp(totp)
			result.entries.push(entryFrom({ ...params, issuer: params.issuer.trim() || who.issuer, account: params.account.trim() || who.account }))
		} catch (e) {
			if (!(e instanceof InvalidTotpError)) {
				throw e
			}
			result.skipped.push({ ...who, reason: /^otpauth:\/\/hotp\//i.test(totp) ? COUNTER_BASED : e.message })
		}
	}
	return result
}

/* ---------- collecting several codes and files ---------- */

/** What makes two codes the same: key, algorithm, digits and period (labels may differ). */
function codeIdentity(totp: string): string | null {
	try {
		const params = parseTotp(totp)
		return [base32Encode(params.secret), params.algorithm, params.digits, params.period].join(':')
	} catch {
		return null
	}
}

export interface AuthenticatorAddResult {
	/** Codes that weren't in the import yet. */
	added: number
	skipped: number
	/** This exact QR code or text was added before (a camera sees each code many times). */
	repeated: boolean
}

/** Collects codes from several QR codes, screenshots, files or pastes into one import, each code once. */
export class AuthenticatorImport {
	readonly entries: AuthenticatorEntry[] = []
	readonly skipped: SkippedAuthenticatorEntry[] = []
	private readonly texts = new Set<string>()
	private readonly codes = new Set<string>()
	private readonly batches = new Map<number, { size: number, indices: Set<number> }>()
	private lastBatch: number | null = null

	/** Throws InvalidAuthenticatorExportError. */
	add(input: string): AuthenticatorAddResult {
		const key = input.trim()
		if (this.texts.has(key)) {
			return { added: 0, skipped: 0, repeated: true }
		}
		const parsed = parseAuthenticatorExport(key)
		this.texts.add(key)
		let added = 0
		for (const entry of parsed.entries) {
			const code = codeIdentity(entry.totp) ?? entry.totp
			if (!this.codes.has(code)) {
				this.codes.add(code)
				this.entries.push(entry)
				added++
			}
		}
		this.skipped.push(...parsed.skipped)
		for (const batch of parsed.batches) {
			const seen = this.batches.get(batch.id) ?? { size: batch.size, indices: new Set<number>() }
			seen.indices.add(batch.index)
			this.batches.set(batch.id, seen)
			this.lastBatch = batch.id
		}
		return { added, skipped: parsed.skipped.length, repeated: false }
	}

	/** How far through a multi-code Google Authenticator export the scanning is, e.g. 2 of 3. */
	get progress(): { scanned: number, total: number } | null {
		const batch = this.lastBatch === null ? undefined : this.batches.get(this.lastBatch)
		return batch ? { scanned: batch.indices.size, total: batch.size } : null
	}
}

/* ---------- where each code goes ---------- */

/**
 * add: into a login without a code · replace: over a login's different code (off by default) ·
 * new: a new login · exists: the vault already has this code.
 */
export type AuthenticatorAction = 'add' | 'replace' | 'new' | 'exists'

export interface AuthenticatorPlanRow {
	entry: AuthenticatorEntry
	action: AuthenticatorAction
	/** The login the code goes into (add, replace) or is already in (exists). */
	itemId: string | null
	/** Whether it is imported unless the user changes it: add and new are, replace and exists aren't. */
	selected: boolean
}

interface LoginEntry {
	id: string
	item: LoginItem
}

/** Lower-case letters and digits only: "Google LLC" and "google-llc" are the same service. */
const simplify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The login is for the code's service: same title, or a website whose domain is the issuer. */
function issuerMatches(login: LoginItem, issuer: string): boolean {
	const key = simplify(issuer)
	if (!key) {
		return false
	}
	if (simplify(login.title) === key) {
		return true
	}
	return login.urls.some((url) => {
		const domain = registrableDomain(url)
		return simplify(domain) === key || simplify(domain.split('.')[0] ?? '') === key
	})
}

/** Usernames that could be the same account: one is empty, or one contains the other ("octocat" and "octocat@example.com"). */
function compatibleAccounts(a: string, b: string): boolean {
	const x = a.trim().toLowerCase()
	const y = b.trim().toLowerCase()
	return !x || !y || x.includes(y) || y.includes(x)
}

/**
 * Pair each code with a login: a login that already has the same code first,
 * then the login with the same service and username, then the vault's only
 * login for that service if it has no code yet and its username doesn't
 * contradict the code's. Anything else becomes a new login, so no code goes
 * into a login it may not belong to. `items` are the vault's items outside
 * the trash.
 */
export function planAuthenticatorImport(entries: AuthenticatorEntry[], items: Iterable<{ id: string, item: Item }>): AuthenticatorPlanRow[] {
	const logins = [...items].filter((e): e is LoginEntry => e.item.type === 'login')
	const owners = new Map<string, string>()
	for (const login of logins) {
		const code = codeIdentity(login.item.totp)
		if (code && !owners.has(code)) {
			owners.set(code, login.id)
		}
	}
	const claimed = new Set<string>()
	const into = (entry: AuthenticatorEntry, login: LoginEntry): AuthenticatorPlanRow => {
		claimed.add(login.id)
		return login.item.totp.trim()
			? { entry, action: 'replace', itemId: login.id, selected: false }
			: { entry, action: 'add', itemId: login.id, selected: true }
	}
	const forService = (entry: AuthenticatorEntry) => logins.filter((l) => issuerMatches(l.item, entry.issuer))

	const rows: (AuthenticatorPlanRow | null)[] = entries.map((entry) => {
		const owner = owners.get(codeIdentity(entry.totp) ?? '')
		if (!owner) {
			return null
		}
		claimed.add(owner)
		return { entry, action: 'exists', itemId: owner, selected: false }
	})
	entries.forEach((entry, i) => {
		const account = entry.account.toLowerCase()
		if (rows[i] || !account) {
			return
		}
		const same = forService(entry).filter((l) => !claimed.has(l.id) && l.item.username.trim().toLowerCase() === account)
		const login = same.find((l) => !l.item.totp.trim()) ?? same[0]
		if (login) {
			rows[i] = into(entry, login)
		}
	})
	entries.forEach((entry, i) => {
		if (rows[i]) {
			return
		}
		const candidates = forService(entry)
		const only = candidates.length === 1 ? candidates[0]! : undefined
		rows[i] = only && !claimed.has(only.id) && !only.item.totp.trim() && compatibleAccounts(entry.account, only.item.username)
			? into(entry, only)
			: { entry, action: 'new', itemId: null, selected: true }
	})
	return rows as AuthenticatorPlanRow[]
}

/** The login a code without a matching login becomes. */
export function newLoginForAuthenticatorEntry(entry: AuthenticatorEntry): LoginItem {
	return newItem('login', { title: entry.issuer || entry.account || 'One-time code', username: entry.account, totp: entry.totp })
}
