/**
 * Offscreen document: the only place the service worker can reach the
 * clipboard. Writes through a `copy` event so an empty string really clears it.
 */
chrome.runtime.onMessage.addListener((message: { target?: string, type?: string, text?: string }, _sender, sendResponse) => {
	if (message?.target !== 'offscreen' || message.type !== 'clipboard') {
		return false
	}
	const text = message.text ?? ''
	const onCopy = (event: ClipboardEvent) => {
		event.clipboardData?.setData('text/plain', text)
		event.preventDefault()
	}
	document.addEventListener('copy', onCopy, { once: true })
	const ok = document.execCommand('copy')
	document.removeEventListener('copy', onCopy)
	sendResponse(ok)
	return false
})
