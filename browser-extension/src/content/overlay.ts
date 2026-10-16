/**
 * V-Pass UI inside web pages: the field icon, the inline menu and the save bar.
 * Everything lives in a closed shadow root; the menu and bar are extension
 * iframes, so the page can neither style nor read them (the page only ever
 * sees values once the user picks something to fill).
 */

const SHIELD = 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm0 6a2.5 2.5 0 0 1 1.25 4.67V16h-2.5v-4.33A2.5 2.5 0 0 1 12 7Z'
const ICON_URL = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#0082c9" fill-rule="evenodd" d="${SHIELD}"/></svg>`)}")`

// The page can style the host element, but !important rules from inside the
// shadow root win over the page's. Together with the iframes' visibility check
// (IntersectionObserver v2) this defeats "invisible extension UI" clickjacking.
const CSS = `
:host { all: initial !important; position: fixed !important; inset: 0 auto auto 0 !important; width: 0 !important; height: 0 !important;
	z-index: 2147483647 !important; display: block !important; opacity: 1 !important; visibility: visible !important; filter: none !important;
	transform: none !important; clip-path: none !important; mask: none !important; mix-blend-mode: normal !important; pointer-events: auto !important; }
.icon { all: initial; position: fixed; width: 22px; height: 22px; cursor: pointer; border-radius: 4px;
	background: ${ICON_URL} center / 16px 16px no-repeat; opacity: .85; }
.icon:hover { opacity: 1; background-color: rgba(0, 130, 201, .12); }
iframe { all: initial; position: fixed; border: 0; border-radius: 10px; background: transparent; color-scheme: light dark;
	box-shadow: 0 6px 24px rgba(0, 0, 0, .28); }
.bar { top: 12px; right: 12px; width: min(400px, calc(100vw - 24px)); height: 156px; }
`

export interface OverlayCallbacks {
	/** The user clicked the field icon. */
	onIconClick: (field: HTMLElement) => void
	/** The menu asked to close (Escape, chose something). */
	onMenuClosed: () => void
}

export class Overlay {
	private readonly host: HTMLElement
	private readonly root: ShadowRoot
	private icon: HTMLElement | null = null
	private iconField: HTMLElement | null = null
	private menu: HTMLIFrameElement | null = null
	private menuField: HTMLElement | null = null
	private menuHeight = 64
	private bar: HTMLIFrameElement | null = null
	private readonly reposition = () => this.layout()

	constructor(private readonly callbacks: OverlayCallbacks) {
		this.host = document.createElement('vpass-overlay')
		this.root = this.host.attachShadow({ mode: 'closed' })
		const style = document.createElement('style')
		style.textContent = CSS
		this.root.append(style)
		window.addEventListener('message', this.onFrameMessage)
		window.addEventListener('scroll', this.reposition, { capture: true, passive: true })
		window.addEventListener('resize', this.reposition, { passive: true })
	}

	private mount(): void {
		if (!this.host.isConnected) {
			document.documentElement.append(this.host)
		}
	}

	/** True when focus or a click target is inside V-Pass UI. */
	contains(node: unknown): boolean {
		return node === this.host
	}

	get menuOpenFor(): HTMLElement | null {
		return this.menu ? this.menuField : null
	}

	/* ----- field icon ----- */

	showIcon(field: HTMLElement): void {
		if (field.getBoundingClientRect().width < 80) {
			return
		}
		this.mount()
		if (!this.icon) {
			this.icon = document.createElement('div')
			this.icon.className = 'icon'
			this.icon.title = 'V-Pass'
			this.icon.addEventListener('mousedown', (e) => {
				e.preventDefault()
				e.stopPropagation()
				if (this.iconField) this.callbacks.onIconClick(this.iconField)
			})
			this.root.append(this.icon)
		}
		this.iconField = field
		this.layout()
	}

	hideIcon(): void {
		this.icon?.remove()
		this.icon = null
		this.iconField = null
	}

	/* ----- inline menu ----- */

	openMenu(field: HTMLElement, url: string): void {
		this.mount()
		this.closeMenu(false)
		const frame = document.createElement('iframe')
		frame.src = url
		frame.setAttribute('allow', '')
		frame.tabIndex = -1
		this.menu = frame
		this.menuField = field
		this.menuHeight = 64
		this.root.append(frame)
		this.layout()
	}

	closeMenu(notify = true): void {
		if (!this.menu) return
		this.menu.remove()
		this.menu = null
		this.menuField = null
		if (notify) this.callbacks.onMenuClosed()
	}

	focusMenu(): void {
		if (!this.menu?.contentWindow) return
		this.menu.focus()
		this.menu.contentWindow.postMessage({ vpass: 'focus' }, new URL(this.menu.src).origin)
	}

	/* ----- save bar ----- */

	showBar(url: string): void {
		this.mount()
		if (this.bar?.src === url) return
		this.bar?.remove()
		const frame = document.createElement('iframe')
		frame.className = 'bar'
		frame.src = url
		this.bar = frame
		this.root.append(frame)
	}

	closeBar(): void {
		this.bar?.remove()
		this.bar = null
	}

	/* ----- layout & messages ----- */

	private layout(): void {
		if (this.icon && this.iconField) {
			const r = this.iconField.getBoundingClientRect()
			if (!this.iconField.isConnected || r.width === 0) {
				this.hideIcon()
			} else {
				Object.assign(this.icon.style, { left: `${r.right - 28}px`, top: `${r.top + (r.height - 22) / 2}px` })
			}
		}
		if (this.menu && this.menuField) {
			const r = this.menuField.getBoundingClientRect()
			const width = Math.min(Math.max(r.width, 300), window.innerWidth - 16)
			const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
			const below = window.innerHeight - r.bottom - 8
			const top = below >= this.menuHeight || r.top < this.menuHeight ? r.bottom + 4 : r.top - this.menuHeight - 4
			Object.assign(this.menu.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${this.menuHeight}px` })
		}
	}

	private readonly onFrameMessage = (event: MessageEvent) => {
		const data = event.data as { vpass?: string, height?: number } | null
		if (!data || typeof data.vpass !== 'string') return
		const fromMenu = this.menu && event.source === this.menu.contentWindow
		const fromBar = this.bar && event.source === this.bar.contentWindow
		if (!fromMenu && !fromBar) return
		if (data.vpass === 'height' && typeof data.height === 'number') {
			const height = Math.max(40, Math.min(420, Math.ceil(data.height)))
			if (fromMenu) {
				this.menuHeight = height
				this.layout()
			} else if (this.bar) {
				this.bar.style.height = `${height}px`
			}
		} else if (data.vpass === 'close') {
			if (fromMenu) {
				const field = this.menuField
				this.closeMenu()
				field?.focus({ preventScroll: true })
			} else {
				this.closeBar()
			}
		}
	}

	destroy(): void {
		window.removeEventListener('message', this.onFrameMessage)
		window.removeEventListener('scroll', this.reposition, { capture: true })
		window.removeEventListener('resize', this.reposition)
		this.host.remove()
	}
}
