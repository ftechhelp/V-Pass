/**
 * Clickjacking guard for V-Pass iframes inside web pages. A page cannot read
 * the iframe, but it could make it invisible (opacity, filters, overlays) and
 * trick the user into clicking it. IntersectionObserver v2 reports whether the
 * iframe is really visible and unobscured; clicks only count after it has been
 * visible for a moment.
 */

interface VisibilityEntry extends IntersectionObserverEntry {
	isVisible?: boolean
}

const MIN_VISIBLE_MS = 400

export function createVisibilityGuard(target: Element): { canInteract: () => boolean, stop: () => void } {
	let visibleSince: number | null = null
	const supported = 'isVisible' in IntersectionObserverEntry.prototype
	if (!supported) {
		// Not Chrome (or very old): don't lock the user out.
		return { canInteract: () => true, stop: () => {} }
	}
	const observer = new IntersectionObserver((entries) => {
		const entry = entries[entries.length - 1] as VisibilityEntry | undefined
		if (entry?.isVisible) {
			visibleSince ??= performance.now()
		} else {
			visibleSince = null
		}
	}, { threshold: [0], trackVisibility: true, delay: 100 } as IntersectionObserverInit)
	observer.observe(target)
	return {
		canInteract: () => visibleSince !== null && performance.now() - visibleSince >= MIN_VISIBLE_MS,
		stop: () => observer.disconnect(),
	}
}

export const NOT_VISIBLE_MESSAGE = 'V-Pass could not confirm this menu is fully visible, so it ignored the click. Use the V-Pass toolbar button instead.'
