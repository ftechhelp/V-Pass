import type { ContentMessages, MessageMap } from '../shared/protocol.ts'

type Send = <K extends keyof ContentMessages>(type: K, payload: MessageMap[K][0]) => Promise<MessageMap[K][1]>

/**
 * The V-Pass web app's "Browser extension" page asks whether this browser has
 * the extension, and can ask it to connect. Runs only on V-Pass pages; the
 * background checks the sender again and never tells a page which server the
 * extension is connected to (only whether it is this one).
 */
export function listenForWebApp(send: Send): () => void {
	const onMessage = (event: MessageEvent) => {
		const data = event.data as { vpass?: string, kind?: string, id?: string } | null
		if (event.source !== window || data?.vpass !== 'webapp' || typeof data.id !== 'string') {
			return
		}
		const id = data.id
		const reply = (body: object) => window.postMessage({ vpass: 'extension', id, ...body }, location.origin)
		if (data.kind === 'status') {
			send('webAppStatus', {}).then(reply, () => reply({ error: 'unavailable' }))
		} else if (data.kind === 'connect') {
			send('webAppConnect', {}).then(reply, (e: Error) => reply({ error: e.message }))
		}
	}
	window.addEventListener('message', onMessage)
	return () => window.removeEventListener('message', onMessage)
}
