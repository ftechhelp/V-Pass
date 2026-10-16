import type { Group, Scan } from './classify.ts'

/**
 * Noticing when the user submits credentials, so V-Pass can offer to save or
 * update them. Covers real form submits, clicks on submit-like buttons (many
 * sites log in with fetch and never submit a form) and Enter in a password field.
 */

export interface SubmittedCredentials {
	username: string
	password: string
	newPassword: string | null
}

/** Read what the user typed into one group. Null when there is no password. */
export function credentialsIn(scan: Scan, group: Group): SubmittedCredentials | null {
	const inGroup = scan.fields.filter((f) => f.group === group)
	const value = (role: string, visibleOnly: boolean) => inGroup
		.filter((f) => f.role === role && (f.visible || !visibleOnly))
		.map((f) => f.el.value.trim())
		.find(Boolean) ?? ''
	const password = inGroup.filter((f) => f.role === 'current-password' && f.visible).map((f) => f.el.value).find(Boolean) ?? ''
	const newPassword = inGroup.filter((f) => f.role === 'new-password' && f.visible).map((f) => f.el.value).find(Boolean) ?? null
	if (!password && !newPassword) {
		return null
	}
	// A hidden username field often carries the identifier from a previous step.
	return { username: value('username', true) || value('username', false), password, newPassword }
}

const SUBMIT_TEXT = /log.?in|sign.?in|sign.?up|register|continue|next|submit|save|update|change|create|join|anmelden|connexion|entrar|weiter/i

function isSubmitLike(el: Element): boolean {
	const button = el.closest('button, input[type=submit], input[type=button], [role=button]')
	if (!button) {
		return false
	}
	if (button instanceof HTMLButtonElement && (button.type === 'submit' || button.form)) {
		return true
	}
	if (button instanceof HTMLInputElement && button.type === 'submit') {
		return true
	}
	const label = button instanceof HTMLInputElement ? button.value : `${button.textContent ?? ''} ${button.getAttribute('aria-label') ?? ''}`
	return SUBMIT_TEXT.test(label)
}

/**
 * Watch the document. `current` returns the latest scan; `report` is called
 * with credentials at most once per distinct submission.
 */
export function watchSubmits(current: () => Scan, report: (creds: SubmittedCredentials) => void): () => void {
	let last = ''
	const send = (creds: SubmittedCredentials) => {
		const key = `${creds.username}\u0000${creds.password}\u0000${creds.newPassword}`
		if (key === last) return
		last = key
		setTimeout(() => {
			if (last === key) last = ''
		}, 3000)
		report(creds)
	}

	const fromGroup = (group: Group | null) => {
		if (!group) return
		const creds = credentialsIn(current(), group)
		if (creds) send(creds)
	}

	/** The group of the element, or the only group on the page that holds a typed password. */
	const groupNear = (el: Element): Group | null => {
		const scan = current()
		const form = el.closest('form')
		if (form && scan.fields.some((f) => f.group === form)) {
			return form
		}
		const withPassword = [...new Set(scan.fields.filter((f) => (f.role === 'current-password' || f.role === 'new-password') && f.visible && f.el.value).map((f) => f.group))]
		return withPassword.length === 1 ? withPassword[0]! : null
	}

	const onSubmit = (event: Event) => {
		if (event.target instanceof HTMLFormElement) fromGroup(event.target)
	}
	const onClick = (event: MouseEvent) => {
		const target = event.composedPath()[0]
		if (target instanceof Element && isSubmitLike(target)) fromGroup(groupNear(target))
	}
	const onKeydown = (event: KeyboardEvent) => {
		const target = event.composedPath()[0]
		if (event.key === 'Enter' && target instanceof HTMLInputElement) {
			const field = current().fields.find((f) => f.el === target)
			if (field) fromGroup(field.group)
		}
	}

	document.addEventListener('submit', onSubmit, true)
	document.addEventListener('click', onClick, true)
	document.addEventListener('keydown', onKeydown, true)
	return () => {
		document.removeEventListener('submit', onSubmit, true)
		document.removeEventListener('click', onClick, true)
		document.removeEventListener('keydown', onKeydown, true)
	}
}
