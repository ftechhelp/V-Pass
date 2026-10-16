import { beforeEach, describe, expect, it } from 'vitest'
import { type Role, type Scan, scanFields, summarize } from '../src/content/classify.ts'
import { fillPayload } from '../src/content/fill.ts'
import { credentialsIn } from '../src/content/submit.ts'

const visible = { isVisible: (el: Element) => !el.hasAttribute('data-hidden') }

function scan(html: string): Scan {
	document.body.innerHTML = html
	return scanFields(document, visible)
}

/** name/id → role, for readable assertions. */
function roles(s: Scan): Record<string, Role> {
	return Object.fromEntries(s.fields.map((f) => [f.el.getAttribute('name') ?? f.el.id, f.role]))
}

const $ = (selector: string) => document.querySelector(selector) as HTMLInputElement

beforeEach(() => {
	document.body.innerHTML = ''
})

describe('field detection', () => {
	it('reads autocomplete attributes first', () => {
		const s = scan(`<form>
			<input name="u" autocomplete="username webauthn">
			<input name="p" type="password" autocomplete="current-password">
		</form>`)
		expect(roles(s)).toEqual({ u: 'username', p: 'current-password' })
		expect(summarize(s)).toMatchObject({ login: true, newPassword: false })
	})

	it('takes the text field before the password as the username', () => {
		const s = scan(`<form><input name="search" placeholder="Search"><label>Login <input name="login"></label><input name="pw" type="password"></form>`)
		expect(roles(s)).toMatchObject({ login: 'username', pw: 'current-password' })
	})

	it('ignores hidden decoy passwords when deciding between login and sign-up', () => {
		const s = scan(`<form><input name="email" type="email"><input name="pw" type="password"><input name="trap" type="password" data-hidden></form>`)
		expect(roles(s)).toMatchObject({ email: 'username', pw: 'current-password' })
	})

	it('recognises sign-up and change-password forms', () => {
		expect(roles(scan(`<form><input name="email" type="email"><input name="a" type="password"><input name="b" type="password"></form>`)))
			.toMatchObject({ email: 'username', a: 'new-password', b: 'new-password' })
		expect(roles(scan(`<form><input name="current" type="password"><input name="new" type="password"><input name="confirm" type="password"></form>`)))
			.toEqual({ current: 'current-password', new: 'new-password', confirm: 'new-password' })
		expect(roles(scan(`<form id="register"><input name="email" type="email"><input name="pw" type="password"><button>Create account</button></form>`)))
			.toMatchObject({ pw: 'new-password' })
	})

	it('finds a lone identifier field (first step of a two-step login)', () => {
		expect(roles(scan(`<form><label>Email or phone <input name="identifier" type="email"></label><button>Next</button></form>`))).toEqual({ identifier: 'username' })
	})

	it('finds one-time code fields, including one box per digit, but not coupon codes', () => {
		expect(roles(scan(`<form><input name="code" autocomplete="one-time-code"></form>`))).toEqual({ code: 'totp' })
		expect(roles(scan(`<form><label>Verification code <input name="vc" maxlength="6"></label></form>`))).toEqual({ vc: 'totp' })
		const boxes = scan(`<form>${[1, 2, 3, 4, 5, 6].map((i) => `<input name="d${i}" maxlength="1" inputmode="numeric">`).join('')}</form>`)
		expect(Object.values(roles(boxes))).toEqual(Array(6).fill('totp'))
		expect(roles(scan(`<form><label>Coupon code <input name="coupon" maxlength="8"></label></form>`))).not.toHaveProperty('coupon', 'totp')
	})

	it('classifies payment card fields', () => {
		const s = scan(`<form>
			<label>Name on card <input name="ccname"></label>
			<label>Card number <input name="cardnumber"></label>
			<label>Expiry (MM/YY) <input name="exp" maxlength="5"></label>
			<label>CVC <input name="cvc"></label>
		</form>`)
		expect(roles(s)).toEqual({ ccname: 'cc-name', cardnumber: 'cc-number', exp: 'cc-exp', cvc: 'cc-csc' })
		expect(summarize(s).card).toBe(true)
		const split = scan(`<form><input name="cc-number" autocomplete="cc-number">
			<select name="exp-month"><option>01</option><option>02</option><option>03</option><option>04</option><option>05</option><option>06</option><option>07</option><option>08</option><option>09</option><option>10</option><option>11</option><option>12</option></select>
			<input name="exp-year" placeholder="YYYY"></form>`)
		expect(roles(split)).toMatchObject({ 'exp-month': 'cc-exp-month', 'exp-year': 'cc-exp-year' })
	})

	it('classifies address fields without autocomplete, ignoring option text in labels', () => {
		const s = scan(`<form>
			<label>First name <input name="first_name"></label>
			<label>Last name <input name="last_name"></label>
			<label>Street <input name="street"></label>
			<label>City <input name="city"></label>
			<label>State / province <input name="region"></label>
			<label>ZIP <input name="zip"></label>
			<label>Country <select name="country"><option>Canada</option><option value="US">United States</option></select></label>
			<label>Phone <input name="phone" type="tel"></label>
		</form>`)
		expect(roles(s)).toEqual({
			first_name: 'given-name', last_name: 'family-name', street: 'address-line1', city: 'address-level2',
			region: 'address-level1', zip: 'postal-code', country: 'country', phone: 'tel',
		})
		expect(summarize(s).identity).toBe(true)
	})

	it('does not call a lone newsletter email box an address form', () => {
		expect(summarize(scan(`<form><label>Email <input name="newsletter" type="email"></label><button>Subscribe</button></form>`)).identity).toBe(false)
	})

	it('looks inside open shadow roots', () => {
		document.body.innerHTML = '<div id="host"></div>'
		const root = $('#host').attachShadow({ mode: 'open' })
		root.innerHTML = '<form><input name="user"><input name="pass" type="password"></form>'
		expect(roles(scanFields(document, visible))).toEqual({ user: 'username', pass: 'current-password' })
	})
})

describe('filling', () => {
	it('fills username and password and fires input/change events', () => {
		const s = scan(`<form><input name="user"><input name="pass" type="password"></form>`)
		const events: string[] = []
		$('[name=pass]').addEventListener('input', () => events.push('input'))
		$('[name=pass]').addEventListener('change', () => events.push('change'))
		expect(fillPayload(s, { username: 'alice', password: 's3cret' }, null, null)).toBe(true)
		expect($('[name=user]').value).toBe('alice')
		expect($('[name=pass]').value).toBe('s3cret')
		expect(events).toEqual(['input', 'change'])
	})

	it('never fills invisible fields', () => {
		const s = scan(`<form><input name="user"><input name="pass" type="password" data-hidden></form>`)
		fillPayload(s, { username: 'alice', password: 's3cret' }, null, null)
		expect($('[name=pass]').value).toBe('')
	})

	it('puts a generated password in both "new" and "confirm"', () => {
		const s = scan(`<form><input name="email" type="email"><input name="a" type="password"><input name="b" type="password"></form>`)
		expect(fillPayload(s, { newPassword: 'G3nerated!' }, 'new-password', $('[name=a]'))).toBe(true)
		expect([$('[name=a]').value, $('[name=b]').value]).toEqual(['G3nerated!', 'G3nerated!'])
		// The keyboard shortcut with nothing focused fills nothing (the background copies instead).
		;(document.activeElement as HTMLElement | null)?.blur()
		expect(fillPayload(s, { newPassword: 'x' }, 'new-password', null)).toBe(false)
	})

	it('spreads a one-time code over one-box-per-digit inputs', () => {
		const s = scan(`<form>${[1, 2, 3, 4, 5, 6].map((i) => `<input name="d${i}" maxlength="1">`).join('')}</form>`)
		fillPayload(s, { totp: '123456' }, 'totp', $('[name=d1]'))
		expect([1, 2, 3, 4, 5, 6].map((i) => $(`[name=d${i}]`).value).join('')).toBe('123456')
	})

	it('formats card expiry for the field and picks select options', () => {
		const s = scan(`<form>
			<input name="cardnumber" autocomplete="cc-number">
			<input name="exp" autocomplete="cc-exp" placeholder="MM/YYYY">
			<select name="year" autocomplete="cc-exp-year"><option value="28">2028</option><option value="29">2029</option></select>
		</form>`)
		fillPayload(s, { card: { 'cc-number': '4111111111111111', 'cc-exp-month': '07', 'cc-exp-year': '2029' } }, 'card', null)
		expect($('[name=exp]').value).toBe('07/2029')
		expect((document.querySelector('[name=year]') as HTMLSelectElement).value).toBe('29')
	})

	it('selects a country by code or name', () => {
		const s = scan(`<form><input name="first" autocomplete="given-name"><input name="zip" autocomplete="postal-code">
			<select name="country" autocomplete="country"><option value="">-</option><option value="DE">Germany</option><option value="CA">Canada</option></select></form>`)
		fillPayload(s, { identity: { 'given-name': 'Alice', 'postal-code': '10115', 'country': 'Germany' } }, 'identity', null)
		expect((document.querySelector('[name=country]') as HTMLSelectElement).value).toBe('DE')
	})
})

describe('submitted credentials', () => {
	it('reads login, sign-up and change-password forms', () => {
		let s = scan(`<form><input name="user" value="alice"><input name="pass" type="password" value="pw1"></form>`)
		expect(credentialsIn(s, s.fields[0]!.group)).toEqual({ username: 'alice', password: 'pw1', newPassword: null })

		s = scan(`<form><input name="email" type="email" value="bob@example.com"><input name="a" type="password" value="new1"><input name="b" type="password" value="new1"></form>`)
		expect(credentialsIn(s, s.fields[0]!.group)).toEqual({ username: 'bob@example.com', password: '', newPassword: 'new1' })

		// Hidden username carried over from an earlier step.
		s = scan(`<form><input name="username" autocomplete="username" value="carol" data-hidden>
			<input name="current" type="password" value="old"><input name="new" type="password" value="fresh"><input name="confirm" type="password" value="fresh"></form>`)
		expect(credentialsIn(s, s.fields[0]!.group)).toEqual({ username: 'carol', password: 'old', newPassword: 'fresh' })
	})

	it('ignores forms without a typed password', () => {
		const s = scan(`<form><input name="user" value="alice"><input name="pass" type="password"></form>`)
		expect(credentialsIn(s, s.fields[0]!.group)).toBeNull()
	})
})
