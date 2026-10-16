import type { CardField, FrameForms, IdentityField } from '../shared/protocol.ts'

/**
 * Field detection: what each input on the page is for. `autocomplete`
 * attributes win; otherwise the field's type, name, id, placeholder, label and
 * position decide. Pure DOM code (no extension APIs) so it can be unit-tested.
 */

export type Role = 'username' | 'current-password' | 'new-password' | 'totp' | CardField | IdentityField
export type FillableElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
export type Group = HTMLFormElement | Document | ShadowRoot

export interface ScannedField {
	el: FillableElement
	role: Role
	group: Group
	visible: boolean
}

export interface Scan {
	fields: ScannedField[]
}

export interface ScanOptions {
	isVisible?: (el: Element) => boolean
}

const CARD_ROLES = new Set<string>(['cc-name', 'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-type'])
const IDENTITY_ROLES = new Set<string>(['name', 'given-name', 'additional-name', 'family-name', 'email', 'tel', 'organization',
	'street-address', 'address-line1', 'address-line2', 'address-level2', 'address-level1', 'postal-code', 'country', 'country-name', 'bday'])
/** Identity roles that indicate a real address/contact form (a lone email box is not one). */
const ADDRESSY = new Set<string>(['name', 'given-name', 'family-name', 'street-address', 'address-line1', 'address-level2', 'postal-code', 'tel'])

export const isCardRole = (role: Role): role is CardField => CARD_ROLES.has(role)
export const isIdentityRole = (role: Role): role is IdentityField => IDENTITY_ROLES.has(role)

const TEXT_TYPES = new Set(['', 'text', 'email', 'tel', 'number', 'search', 'url', 'password'])

const RX = {
	newPassword: /new|confirm|repeat|retype|re-?enter|again|verif|password.?2|pass.?2|pwd.?2/,
	currentPassword: /current|old|existing|actual/,
	signup: /regist|sign.?up|create.?(an?.?)?(account|profile)|join|enrol|new.?account|onboard/,
	username: /user.?name|user.?id|login|log.?in|identifier|e.?mail|account|member|nick|handle|\buid\b|benutzer/,
	totpStrong: /one.?time|\botp\b|totp|2fa|two.?factor|\bmfa\b|verification.?code|verify.?code|auth.?code|authenticator|passcode|sms.?code|security.?code/,
	totpWeak: /\bcode\b|token|\bpin\b/,
	notTotp: /coupon|promo|voucher|gift|zip|postal|post.?code|country|area|discount|referr|invite/,
	ccNumber: /card.?(number|no\b|num)|cc.?(number|num|no\b)|credit.?card|ccnum|cardnum|card.?nr|kartennummer|\bpan\b/,
	ccName: /name.?on.?card|card.?holder|cardholder|cc.?name|card.?name|holder.?name/,
	ccExp: /expir|exp.?date|mm.?\/?.?yy|valid.?thru|valid.?until|cc.?exp|card.?exp/,
	ccExpBoth: /mm\s*\/?\s*(yy|aa|jj)/,
	ccExpMonth: /month|\bmm\b|exp.?m\b/,
	ccExpYear: /year|\byy(yy)?\b|exp.?y\b/,
	ccCsc: /cvc|cvv|csc|cvn|ccv|security.?code|card.?code|card.?verif/,
	givenName: /first.?name|given.?name|\bfname\b|forename|vorname|pr[ée]nom/,
	middleName: /middle.?name|\bmname\b/,
	familyName: /last.?name|family.?name|surname|\blname\b|nachname/,
	fullName: /full.?name|your.?name|^name$|\bname\b/,
	email: /e.?mail/,
	tel: /phone|mobile|\btel\b|telephone|\bcell\b/,
	organization: /company|organi[sz]ation|business|employer/,
	address2: /address.?(line)?.?2|addr.?2|\bapt\b|apartment|suite|\bunit\b/,
	address1: /address.?(line)?.?1|street|addr.?1|address|adresse|strasse/,
	city: /city|town|locality|\bort\b|ville/,
	state: /state|province|region|county|prefecture/,
	postal: /\bzip|postal|post.?code|postcode|\bplz\b/,
	country: /country|nation/,
	bday: /birth|\bdob\b|bday/,
}

const AUTOCOMPLETE_ROLES: Record<string, Role | 'email'> = {
	'username': 'username',
	'current-password': 'current-password',
	'new-password': 'new-password',
	'one-time-code': 'totp',
	'cc-name': 'cc-name',
	'cc-number': 'cc-number',
	'cc-exp': 'cc-exp',
	'cc-exp-month': 'cc-exp-month',
	'cc-exp-year': 'cc-exp-year',
	'cc-csc': 'cc-csc',
	'cc-type': 'cc-type',
	'name': 'name',
	'given-name': 'given-name',
	'additional-name': 'additional-name',
	'family-name': 'family-name',
	'email': 'email',
	'tel': 'tel',
	'tel-national': 'tel',
	'organization': 'organization',
	'street-address': 'street-address',
	'address-line1': 'address-line1',
	'address-line2': 'address-line2',
	'address-level2': 'address-level2',
	'address-level1': 'address-level1',
	'postal-code': 'postal-code',
	'country': 'country',
	'country-name': 'country-name',
	'bday': 'bday',
}

function autocompleteRole(el: FillableElement): Role | null {
	const tokens = (el.getAttribute('autocomplete') ?? '').trim().toLowerCase().split(/\s+/).filter((t) => t && t !== 'webauthn')
	const last = tokens[tokens.length - 1]
	return last ? (AUTOCOMPLETE_ROLES[last] as Role | undefined) ?? null : null
}

function textOf(node: Element | null | undefined): string {
	return (node?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** A label's own text, without the text of controls nested in it (a select's options, say). */
function labelText(label: Element | null | undefined): string {
	if (!label) return ''
	let text = ''
	const walker = label.ownerDocument.createTreeWalker(label, NodeFilter.SHOW_TEXT)
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (!node.parentElement?.closest('select, option, textarea, button')) text += ` ${node.textContent ?? ''}`
	}
	return text.replace(/\s+/g, ' ').trim()
}

/** Everything that describes a field, lower-cased. */
export function hintsOf(el: FillableElement): string {
	const parts = [el.getAttribute('name'), el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('title'),
		el.getAttribute('data-testid'), typeof el.className === 'string' ? el.className : '']
	const labelledBy = el.getAttribute('aria-labelledby')
	if (labelledBy) {
		const root = el.getRootNode() as Document | ShadowRoot
		for (const id of labelledBy.split(/\s+/)) parts.push(textOf(root.getElementById?.(id)))
	}
	if ('labels' in el && el.labels) {
		for (const label of el.labels) parts.push(labelText(label))
	}
	parts.push(labelText(el.closest('label')))
	return parts.filter(Boolean).join(' ').toLowerCase().replace(/[_-]+/g, ' ')
}

function groupOf(el: FillableElement): Group {
	return el.form ?? el.closest('form') ?? (el.getRootNode() as Document | ShadowRoot)
}

/** Text of the group itself: form id/name/action/class and its buttons (for signup detection). */
function groupHints(group: Group): string {
	if (!(group instanceof HTMLFormElement)) {
		return ''
	}
	const buttons = [...group.querySelectorAll('button, input[type=submit]')].map((b) => b instanceof HTMLInputElement ? b.value : textOf(b))
	return [group.id, group.getAttribute('name'), group.getAttribute('action'), group.className, ...buttons].join(' ').toLowerCase()
}

/** All inputs, selects and textareas, including inside open shadow roots, in document order. */
export function collectFields(root: Document | ShadowRoot): FillableElement[] {
	const out: FillableElement[] = []
	const walker = (root.ownerDocument ?? root as Document).createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
	for (let node = walker.currentNode as Element | null; node; node = walker.nextNode() as Element | null) {
		if (node instanceof HTMLInputElement) {
			if (TEXT_TYPES.has(node.type) && !node.disabled && !node.readOnly) out.push(node)
		} else if (node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement) {
			if (!node.disabled) out.push(node)
		}
		if (node.shadowRoot) {
			out.push(...collectFields(node.shadowRoot))
		}
	}
	return out
}

export function defaultIsVisible(el: Element): boolean {
	const rect = el.getBoundingClientRect()
	if (rect.width < 4 || rect.height < 4 || rect.right < 0 || rect.bottom < 0) {
		return false
	}
	const style = getComputedStyle(el)
	return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
}

const isPassword = (el: FillableElement) => el instanceof HTMLInputElement && el.type === 'password'
const isTextLike = (el: FillableElement) => el instanceof HTMLInputElement && el.type !== 'password'
const maxLen = (el: FillableElement) => el instanceof HTMLInputElement && el.maxLength > 0 ? el.maxLength : null

function looksLikeTotp(el: FillableElement, hints: string): boolean {
	if (!isTextLike(el) || RX.notTotp.test(hints)) {
		return false
	}
	const input = el as HTMLInputElement
	const numeric = input.inputMode === 'numeric' || input.type === 'tel' || input.type === 'number' || /\d/.test(input.pattern)
	const len = maxLen(el)
	const shortish = len !== null && len >= 4 && len <= 10
	return RX.totpStrong.test(hints) ? true : RX.totpWeak.test(hints) && (numeric || shortish)
}

/** Six (or four, or eight) single-character boxes in a row: a split one-time-code input. */
function splitOtpRuns(inputs: FillableElement[]): Set<FillableElement> {
	const result = new Set<FillableElement>()
	let run: FillableElement[] = []
	const flush = () => {
		if (run.length >= 4 && run.length <= 8) run.forEach((el) => result.add(el))
		run = []
	}
	for (const el of inputs) {
		if (isTextLike(el) && maxLen(el) === 1) {
			run.push(el)
		} else {
			flush()
		}
	}
	flush()
	return result
}

function cardRole(el: FillableElement, hints: string): Role | null {
	if (RX.ccNumber.test(hints)) return 'cc-number'
	if (RX.ccCsc.test(hints)) return 'cc-csc'
	if (RX.ccName.test(hints)) return 'cc-name'
	// "MM/YY", "MM / YYYY", "MMYY": one field for both, unless it only fits two characters.
	const len = maxLen(el)
	if (RX.ccExpBoth.test(hints) && (len === null || len >= 4)) return 'cc-exp'
	if (RX.ccExpMonth.test(hints) || (el instanceof HTMLSelectElement && el.options.length >= 12 && el.options.length <= 14 && /jan|01|\b1\b/i.test(textOf(el)))) return 'cc-exp-month'
	if (RX.ccExpYear.test(hints)) return 'cc-exp-year'
	if (RX.ccExp.test(hints)) return 'cc-exp'
	return null
}

function identityRole(el: FillableElement, hints: string): Role | null {
	if (el instanceof HTMLInputElement && el.type === 'email') return 'email'
	if (el instanceof HTMLInputElement && el.type === 'tel') return 'tel'
	if (RX.email.test(hints)) return 'email'
	if (RX.givenName.test(hints)) return 'given-name'
	if (RX.middleName.test(hints)) return 'additional-name'
	if (RX.familyName.test(hints)) return 'family-name'
	if (RX.tel.test(hints)) return 'tel'
	if (RX.organization.test(hints)) return 'organization'
	if (RX.postal.test(hints)) return 'postal-code'
	if (RX.address2.test(hints)) return 'address-line2'
	if (RX.address1.test(hints)) return el instanceof HTMLTextAreaElement ? 'street-address' : 'address-line1'
	if (RX.country.test(hints)) return 'country'
	if (RX.city.test(hints)) return 'address-level2'
	if (RX.state.test(hints)) return 'address-level1'
	if (RX.bday.test(hints)) return 'bday'
	if (RX.fullName.test(hints)) return 'name'
	return null
}

/** Classify every field in one form (or one formless document/shadow root). */
function classifyGroup(group: Group, inputs: FillableElement[], visible: Map<FillableElement, boolean>): Map<FillableElement, Role> {
	const roles = new Map<FillableElement, Role>()
	const hints = new Map(inputs.map((el) => [el, hintsOf(el)]))
	const auto = new Map(inputs.map((el) => [el, autocompleteRole(el)]))

	// 1. Passwords.
	const passwords = inputs.filter(isPassword)
	const unresolved: FillableElement[] = []
	for (const el of passwords) {
		const role = auto.get(el)
		if (role === 'current-password' || role === 'new-password') {
			roles.set(el, role)
		} else if (RX.currentPassword.test(hints.get(el)!)) {
			roles.set(el, 'current-password')
		} else if (RX.newPassword.test(hints.get(el)!)) {
			roles.set(el, 'new-password')
		} else {
			unresolved.push(el)
		}
	}
	if (unresolved.length) {
		// Position decides among the *visible* passwords (hidden decoys don't count).
		const known = new Set(roles.values())
		const visiblePasswords = passwords.filter((el) => visible.get(el))
		const positional = unresolved.filter((el) => visible.get(el))
		unresolved.filter((el) => !visible.get(el)).forEach((el) => roles.set(el, 'current-password'))
		if (visiblePasswords.length >= 3) {
			// current, new, confirm
			positional.forEach((el) => roles.set(el, el === visiblePasswords[0] && !known.has('current-password') ? 'current-password' : 'new-password'))
		} else if (visiblePasswords.length === 2) {
			// new + confirm (change forms name their "current" field, which the hints catch)
			positional.forEach((el) => roles.set(el, 'new-password'))
		} else {
			positional.forEach((el) => roles.set(el, RX.signup.test(groupHints(group)) ? 'new-password' : 'current-password'))
		}
	}

	// 2. Autocomplete for everything else.
	for (const el of inputs) {
		const role = auto.get(el)
		if (!roles.has(el) && role && !isPassword(el)) {
			roles.set(el, role)
		}
	}

	// 3. Split one-time-code boxes.
	for (const el of splitOtpRuns(inputs)) {
		if (!roles.has(el)) roles.set(el, 'totp')
	}

	const cardContext = inputs.some((el) => roles.get(el) === 'cc-number' || RX.ccNumber.test(hints.get(el)!))
	const firstPassword = passwords.find((el) => visible.get(el)) ?? passwords[0]
	const hasLoginPassword = passwords.some((el) => roles.get(el) === 'current-password' || roles.get(el) === 'new-password')

	for (const el of inputs) {
		if (roles.has(el) || isPassword(el)) continue
		const h = hints.get(el)!
		// 4. Payment cards.
		if (cardContext) {
			const role = cardRole(el, h)
			if (role) {
				roles.set(el, role)
				continue
			}
		}
		// 5. One-time codes.
		if (looksLikeTotp(el, h)) {
			roles.set(el, 'totp')
		}
	}

	// 6. Username: the text field right before the first password, or a hinted one.
	if (hasLoginPassword && firstPassword) {
		const before = inputs.slice(0, inputs.indexOf(firstPassword)).filter((el) => isTextLike(el) && (!roles.has(el) || roles.get(el) === 'email' || roles.get(el) === 'tel'))
		const hinted = before.filter((el) => roles.get(el) === 'email' || RX.username.test(hints.get(el)!))
		const pick = hinted[hinted.length - 1] ?? before[before.length - 1]
		if (pick) roles.set(pick, 'username')
	} else if (!passwords.length) {
		// Identifier-first login step: a lone username/email box.
		const texts = inputs.filter((el) => isTextLike(el) && !roles.has(el))
		const explicit = inputs.filter((el) => auto.get(el) === 'username')
		const candidates = explicit.length ? explicit : texts.length <= 2 ? texts.filter((el) => RX.username.test(hints.get(el)!) && !RX.signup.test(groupHints(group))) : []
		if (candidates.length === 1) roles.set(candidates[0]!, 'username')
	}

	// 7. Addresses and contact details.
	for (const el of inputs) {
		if (roles.has(el) || isPassword(el)) continue
		const role = identityRole(el, hints.get(el)!)
		if (role) roles.set(el, role)
	}
	return roles
}

export function scanFields(root: Document | ShadowRoot, options: ScanOptions = {}): Scan {
	const isVisible = options.isVisible ?? defaultIsVisible
	const byGroup = new Map<Group, FillableElement[]>()
	for (const el of collectFields(root)) {
		const group = groupOf(el)
		const list = byGroup.get(group) ?? []
		list.push(el)
		byGroup.set(group, list)
	}
	const fields: ScannedField[] = []
	for (const [group, inputs] of byGroup) {
		const visible = new Map(inputs.map((el) => [el, isVisible(el)]))
		for (const [el, role] of classifyGroup(group, inputs, visible)) {
			fields.push({ el, role, group, visible: visible.get(el)! })
		}
	}
	return { fields }
}

/** What the frame offers, counting visible fields only. */
export function summarize(scan: Scan): FrameForms {
	const visible = scan.fields.filter((f) => f.visible)
	const has = (role: Role) => visible.some((f) => f.role === role)
	const identityGroups = new Map<Group, Set<string>>()
	for (const f of visible) {
		if (ADDRESSY.has(f.role)) {
			const set = identityGroups.get(f.group) ?? new Set()
			set.add(f.role)
			identityGroups.set(f.group, set)
		}
	}
	return {
		login: has('current-password') || has('username'),
		newPassword: has('new-password'),
		totp: has('totp'),
		card: has('cc-number') || visible.filter((f) => isCardRole(f.role)).length >= 2,
		identity: [...identityGroups.values()].some((set) => set.size >= 2),
	}
}

/** Group a field belongs to (for fills anchored on the field the user is in). */
export function fieldFor(scan: Scan, el: Element | null): ScannedField | undefined {
	return el ? scan.fields.find((f) => f.el === el) : undefined
}
