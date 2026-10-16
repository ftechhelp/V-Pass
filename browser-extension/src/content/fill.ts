import type { FieldKind, FillPayload } from '../shared/protocol.ts'
import { type FillableElement, type Group, type Role, type Scan, type ScannedField, isCardRole, isIdentityRole } from './classify.ts'

/**
 * Writing values into page fields so that frameworks (React, Vue, Angular)
 * notice: the native value setter, then the events a user's typing produces.
 * Only visible fields are ever filled.
 */

let filling = false

/** True while V-Pass is dispatching its own events (so focus handlers can ignore them). */
export function isFilling(): boolean {
	return filling
}

const nativeValueSetter = (el: HTMLInputElement | HTMLTextAreaElement) =>
	Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!

function pickOption(select: HTMLSelectElement, value: string): boolean {
	const wanted = value.trim().toLowerCase()
	const asNumber = /^\d+$/.test(wanted) ? Number(wanted) : null
	const options = [...select.options]
	const match = options.find((o) => o.value.trim().toLowerCase() === wanted || o.text.trim().toLowerCase() === wanted)
		?? (asNumber !== null ? options.find((o) => Number(o.value) === asNumber || Number(o.text.trim()) === asNumber) : undefined)
		?? (wanted.length > 2 ? options.find((o) => o.text.trim().toLowerCase().startsWith(wanted)) : undefined)
	if (!match) {
		return false
	}
	select.value = match.value
	return true
}

export function setFieldValue(el: FillableElement, value: string): boolean {
	filling = true
	try {
		if (el instanceof HTMLSelectElement) {
			if (!pickOption(el, value)) return false
		} else {
			el.focus({ preventScroll: true })
			el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true }))
			nativeValueSetter(el).call(el, value)
			el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value }))
			el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true }))
		}
		el.dispatchEvent(new Event('change', { bubbles: true }))
		el.dispatchEvent(new FocusEvent('blur', { bubbles: false }))
		return true
	} finally {
		filling = false
	}
}

function visibleIn(scan: Scan, group: Group | null, test: (role: Role) => boolean): ScannedField[] {
	return scan.fields.filter((f) => f.visible && (group === null || f.group === group) && test(f.role))
}

/** The group to fill: where the user is, else the most login-like visible group. */
function loginGroup(scan: Scan, anchor: ScannedField | undefined): Group | null {
	if (anchor) {
		return anchor.group
	}
	const groups = scan.fields.filter((f) => f.visible).map((f) => f.group)
	return groups.find((g) => visibleIn(scan, g, (r) => r === 'current-password').length > 0)
		?? groups.find((g) => visibleIn(scan, g, (r) => r === 'username').length > 0)
		?? null
}

function fillOtp(fields: ScannedField[], code: string): boolean {
	if (fields.length >= 4 && fields.every((f) => f.el instanceof HTMLInputElement && f.el.maxLength === 1)) {
		// One box per digit.
		return fields.slice(0, code.length).map((f, i) => setFieldValue(f.el, code[i]!)).some(Boolean)
	}
	return fields[0] ? setFieldValue(fields[0].el, code) : false
}

function formatExpiry(el: FillableElement, month: string, year: string): string {
	const placeholder = (el.getAttribute('placeholder') ?? '').toLowerCase()
	const max = el instanceof HTMLInputElement && el.maxLength > 0 ? el.maxLength : 0
	if (/yyyy|aaaa|jjjj/.test(placeholder) || max === 7) return `${month}/${year}`
	if (max === 4) return `${month}${year.slice(-2)}`
	return `${month}/${year.slice(-2)}`
}

function cardValue(field: ScannedField, card: NonNullable<FillPayload['card']>): string | undefined {
	switch (field.role) {
	case 'cc-exp':
		return card['cc-exp-month'] && card['cc-exp-year'] ? formatExpiry(field.el, card['cc-exp-month'], card['cc-exp-year']) : undefined
	case 'cc-exp-year': {
		const year = card['cc-exp-year']
		const short = field.el instanceof HTMLInputElement && field.el.maxLength === 2
		return year && short ? year.slice(-2) : year
	}
	default:
		return card[field.role as keyof typeof card]
	}
}

function identityValue(field: ScannedField, identity: NonNullable<FillPayload['identity']>): string | undefined {
	if (field.role === 'street-address' && !(field.el instanceof HTMLTextAreaElement)) {
		return identity['street-address']?.replace(/\n/g, ', ')
	}
	if (field.role === 'country' && field.el instanceof HTMLSelectElement) {
		return identity.country
	}
	return identity[field.role as keyof typeof identity]
}

/**
 * Fill `payload` into the scanned frame. `anchor` is the field the user opened
 * the menu on (or the focused field); `fieldKind` says what was asked for.
 * Returns true when at least one field was filled.
 */
export function fillPayload(scan: Scan, payload: FillPayload, fieldKind: FieldKind | null, anchorEl: Element | null): boolean {
	const anchor = anchorEl ? scan.fields.find((f) => f.el === anchorEl) : undefined
	let filled = false

	if (payload.newPassword !== undefined) {
		// The menu's field, or (keyboard shortcut) the focused one; it must be a password field.
		const target = anchor ?? scan.fields.find((f) => f.el === deepActiveElement())
		const isPasswordField = target && target.el instanceof HTMLInputElement && (target.el.type === 'password' || target.role === 'new-password')
		if (!target || !isPasswordField) {
			return false
		}
		// "New" and "confirm" both get it.
		const group = visibleIn(scan, target.group, (r) => r === 'new-password')
		for (const f of group.length ? group : [target]) {
			filled = setFieldValue(f.el, payload.newPassword) || filled
		}
		return filled
	}

	if (fieldKind === 'totp' && payload.totp) {
		return fillOtp(visibleIn(scan, anchor?.group ?? null, (r) => r === 'totp'), payload.totp)
	}

	if (payload.username !== undefined || payload.password !== undefined) {
		const group = loginGroup(scan, anchor)
		if (group) {
			const user = visibleIn(scan, group, (r) => r === 'username')[0]
			if (user && payload.username) filled = setFieldValue(user.el, payload.username) || filled
			for (const f of visibleIn(scan, group, (r) => r === 'current-password')) {
				if (payload.password) filled = setFieldValue(f.el, payload.password) || filled
			}
		}
		const otp = visibleIn(scan, null, (r) => r === 'totp')
		if (payload.totp && otp.length) {
			filled = fillOtp(otp, payload.totp) || filled
		}
		return filled
	}

	if (payload.card) {
		for (const f of visibleIn(scan, anchor?.group ?? null, isCardRole)) {
			const value = cardValue(f, payload.card)
			if (value) filled = setFieldValue(f.el, value) || filled
		}
		return filled
	}

	if (payload.identity) {
		const group = anchor?.group ?? scan.fields.find((f) => f.visible && isIdentityRole(f.role))?.group ?? null
		for (const f of visibleIn(scan, group, isIdentityRole)) {
			const value = identityValue(f, payload.identity)
			if (value) filled = setFieldValue(f.el, value) || filled
		}
		return filled
	}
	return false
}

/** document.activeElement, following open shadow roots. */
export function deepActiveElement(): Element | null {
	let el = document.activeElement
	while (el?.shadowRoot?.activeElement) {
		el = el.shadowRoot.activeElement
	}
	return el
}
