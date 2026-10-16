import { showConfirmation, showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { usePreferencesStore } from '../stores/preferences.ts'

let clearTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Copy to the clipboard and clear it again after the configured delay, but only
 * if it still holds what we put there (when the browser lets us check).
 */
export async function copyToClipboard(value: string, label: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(value)
	} catch {
		showError(t('vpass', 'Could not copy to the clipboard'))
		return
	}
	const seconds = usePreferencesStore().clipboardClearSeconds
	showSuccess(seconds > 0
		? t('vpass', '{label} copied. The clipboard is cleared in {seconds} seconds.', { label, seconds })
		: t('vpass', '{label} copied', { label }))
	clearTimeout(clearTimer)
	if (seconds > 0) {
		clearTimer = setTimeout(async () => {
			try {
				const current = await navigator.clipboard.readText()
				if (current !== value) {
					return
				}
			} catch {
				// Reading needs a permission we may not have; clear anyway.
			}
			navigator.clipboard.writeText('').catch(() => {})
		}, seconds * 1000)
	}
}

export function saveFile(content: BlobPart, fileName: string, mimeType = 'application/octet-stream'): void {
	const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
	const a = document.createElement('a')
	a.href = url
	a.download = fileName
	a.rel = 'noopener'
	document.body.appendChild(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function readFileAsText(file: File): Promise<string> {
	return file.text()
}

/** Let the browser paint (e.g. a spinner) before blocking work such as Argon2id. */
export function nextFrame(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 30))
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Styled confirmation dialog; resolves true when confirmed. */
export function confirmAction(name: string, text: string, labelConfirm: string, destructive = true): Promise<boolean> {
	return showConfirmation({ name, text, labelConfirm, labelReject: t('vpass', 'Cancel'), severity: destructive ? 'warning' : 'info' })
}
