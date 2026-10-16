import type { ContentCommand, ContentMessages, FieldKind, FrameForms, MessageMap } from '../shared/protocol.ts'
import { send as runtimeSend } from '../shared/runtime.ts'
import { WebAuthnBridge } from './bridge.ts'
import { type Role, type Scan, fieldFor, isCardRole, isIdentityRole, scanFields, summarize } from './classify.ts'
import { deepActiveElement, fillPayload, isFilling } from './fill.ts'
import { Overlay } from './overlay.ts'
import { watchSubmits } from './submit.ts'

/**
 * Isolated-world content script (every http(s) frame, from document_start).
 * Finds fillable fields, shows the V-Pass field icon and inline menu, fills
 * what the background sends, reports submitted credentials and relays passkey
 * requests for the page-world shim. It never holds vault data beyond the
 * values it is asked to fill.
 */
(() => {
	const scope = globalThis as { __vpassContentAlive?: () => boolean }
	if (scope.__vpassContentAlive?.()) {
		return
	}
	let alive = true
	scope.__vpassContentAlive = () => alive && Boolean(chrome.runtime?.id)

	const cleanups: (() => void)[] = []
	function teardown(): void {
		if (!alive) return
		alive = false
		cleanups.forEach((fn) => fn())
	}

	async function send<K extends keyof ContentMessages>(type: K, payload: MessageMap[K][0]): Promise<MessageMap[K][1]> {
		try {
			return await runtimeSend(type, payload)
		} catch (e) {
			if (!chrome.runtime?.id) teardown()
			throw e
		}
	}

	const bridge = new WebAuthnBridge(send)
	cleanups.push(() => bridge.destroy())

	/* ---------- scanning ---------- */

	let scan: Scan = { fields: [] }
	let status = { locked: true, matches: 0, inlineMenu: true, offerToSave: true }
	let reported = ''

	function rescan(): Scan {
		scan = scanFields(document)
		const summary = summarize(scan)
		const key = JSON.stringify(summary)
		if (key !== reported && (reported || Object.values(summary).some(Boolean))) {
			reported = key
			void report(summary)
		}
		return scan
	}

	async function report(forms: FrameForms): Promise<void> {
		try {
			status = await send('frameForms', { forms })
		} catch {
			// background unavailable
		}
	}

	let scanTimer: ReturnType<typeof setTimeout> | undefined
	function scheduleRescan(): void {
		clearTimeout(scanTimer)
		scanTimer = setTimeout(() => alive && rescan(), 300)
	}

	const observer = new MutationObserver((records) => {
		for (const record of records) {
			const target = record.target
			if (record.type === 'childList' || target instanceof HTMLInputElement || target instanceof HTMLFormElement
				|| (target instanceof Element && target.getElementsByTagName('input').length > 0)) {
				scheduleRescan()
				return
			}
		}
	})
	cleanups.push(() => observer.disconnect(), () => clearTimeout(scanTimer))

	/* ---------- inline menu ---------- */

	function kindOf(role: Role | undefined): FieldKind | null {
		switch (role) {
		case undefined: return null
		case 'username': return 'username'
		case 'current-password': return 'password'
		case 'new-password': return 'new-password'
		case 'totp': return 'totp'
		default: return isCardRole(role) ? 'card' : isIdentityRole(role) ? 'identity' : null
		}
	}

	const overlay = new Overlay({
		onIconClick: (field) => void openMenu(field),
		onMenuClosed: () => {},
	})
	cleanups.push(() => overlay.destroy())

	/** `auto`: opened on focus rather than by a click, so give up if the user started typing meanwhile. */
	async function openMenu(el: HTMLElement, auto = false): Promise<void> {
		const kind = kindOf(fieldFor(scan, el)?.role)
		if (!kind) return
		const login = kind === 'username' || kind === 'password'
		try {
			const { url } = await send('openInline', { fieldKind: kind, conditional: login ? bridge.conditionalRequest : null })
			if (deepActiveElement() !== el || (auto && (el as HTMLInputElement).value)) {
				return
			}
			overlay.openMenu(el, url)
		} catch {
			// background unavailable
		}
	}

	function onFocusIn(event: FocusEvent): void {
		if (isFilling() || !alive) return
		const el = event.composedPath()[0]
		if (!(el instanceof HTMLElement) || overlay.contains(el)) return
		let field = fieldFor(scan, el)
		if (!field && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
			field = fieldFor(rescan(), el)
		}
		const kind = kindOf(field?.role)
		if (!field || !kind || !status.inlineMenu || !field.visible) {
			overlay.hideIcon()
			return
		}
		overlay.showIcon(el)
		if (overlay.menuOpenFor && overlay.menuOpenFor !== el) {
			overlay.closeMenu()
		}
		if (kind === 'username' || kind === 'password' || kind === 'totp') {
			// Open automatically when there is something to offer for this site.
			void (async () => {
				await report(summarize(scan))
				const empty = !(el as HTMLInputElement).value
				if (empty && deepActiveElement() === el && !overlay.menuOpenFor && ((!status.locked && status.matches > 0) || bridge.conditionalRequest)) {
					await openMenu(el, true)
				}
			})()
		}
	}

	function onFocusOut(): void {
		setTimeout(() => {
			if (!alive || overlay.contains(document.activeElement)) return
			const active = deepActiveElement()
			if (overlay.menuOpenFor && active !== overlay.menuOpenFor) overlay.closeMenu()
			if (!fieldFor(scan, active)) overlay.hideIcon()
		}, 150)
	}

	function onKeyDown(event: KeyboardEvent): void {
		const field = overlay.menuOpenFor
		if (!field || event.composedPath()[0] !== field) return
		if (event.key === 'Escape') {
			overlay.closeMenu()
		} else if (event.key === 'ArrowDown') {
			event.preventDefault()
			overlay.focusMenu()
		}
	}

	/** Typing their own value means the user doesn't want the menu in the way. */
	function onInput(event: Event): void {
		if (!isFilling() && overlay.menuOpenFor && event.composedPath()[0] === overlay.menuOpenFor) {
			overlay.closeMenu()
		}
	}

	function onMouseDown(event: MouseEvent): void {
		const target = event.composedPath()[0]
		if (overlay.menuOpenFor && !overlay.contains(target) && target !== overlay.menuOpenFor && !event.composedPath().some((n) => overlay.contains(n))) {
			overlay.closeMenu()
		}
	}

	document.addEventListener('focusin', onFocusIn, true)
	document.addEventListener('focusout', onFocusOut, true)
	document.addEventListener('keydown', onKeyDown, true)
	document.addEventListener('mousedown', onMouseDown, true)
	document.addEventListener('input', onInput, true)
	cleanups.push(() => {
		document.removeEventListener('input', onInput, true)
		document.removeEventListener('focusin', onFocusIn, true)
		document.removeEventListener('focusout', onFocusOut, true)
		document.removeEventListener('keydown', onKeyDown, true)
		document.removeEventListener('mousedown', onMouseDown, true)
	})

	/* ---------- save prompts ---------- */

	cleanups.push(watchSubmits(() => rescan(), (creds) => {
		if (status.offerToSave) {
			send('submitted', creds).catch(() => {})
		}
	}))

	/* ---------- commands from the background ---------- */

	const onCommand = (command: ContentCommand, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void): boolean => {
		if (!alive || sender.id !== chrome.runtime.id || sender.tab) {
			return false
		}
		switch (command.type) {
		case 'fill': {
			rescan()
			const focused = fieldFor(scan, deepActiveElement())?.el ?? null
			const anchor = overlay.menuOpenFor ?? (command.fieldKind === null || command.fieldKind === 'new-password' ? focused : null)
			sendResponse({ filled: fillPayload(scan, command.payload, command.fieldKind, anchor) })
			return false
		}
		case 'closeInline':
			overlay.closeMenu(false)
			return false
		case 'showSaveBar':
			if (window === window.top) overlay.showBar(command.url)
			return false
		case 'closeSaveBar':
			overlay.closeBar()
			return false
		case 'fido2Result':
			bridge.deliver(command.requestId, command.result)
			return false
		case 'passkeyChosen':
			overlay.closeMenu(false)
			void bridge.passkeyChosen(command.credentialId)
			return false
		}
		return false
	}
	chrome.runtime.onMessage.addListener(onCommand)
	cleanups.push(() => chrome.runtime.onMessage.removeListener(onCommand))

	/* ---------- start ---------- */

	function start(): void {
		if (!alive) return
		rescan()
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['type', 'hidden', 'style', 'class', 'autocomplete', 'disabled'],
		})
		if (window === window.top) {
			send('pendingSaveBar', {}).then((bar) => bar && overlay.showBar(bar.url)).catch(() => {})
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', start, { once: true })
	} else {
		start()
	}
})()
