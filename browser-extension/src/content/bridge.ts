import type { RequestOptionsJSON } from '@vpass/core'
import type { ConditionalRequest, ContentMessages, Fido2Result, MessageMap } from '../shared/protocol.ts'
import type { ContentReply, PageMessage } from './page-protocol.ts'

type Send = <K extends keyof ContentMessages>(type: K, payload: MessageMap[K][0]) => Promise<MessageMap[K][1]>

const fallback: Fido2Result = { status: 'fallback' }

/**
 * Isolated-world half of the WebAuthn bridge: relays the page shim's requests
 * to the background and the background's results back to the page.
 */
export class WebAuthnBridge {
	private conditional: { id: string, options: RequestOptionsJSON } | null = null

	constructor(private readonly send: Send) {
		window.addEventListener('message', this.onMessage)
	}

	/** The pending passkey-autofill request, if any (shown in the inline menu). */
	get conditionalRequest(): ConditionalRequest | null {
		const c = this.conditional
		return c ? { rpId: c.options.rpId ?? null, allowCredentials: c.options.allowCredentials ?? [] } : null
	}

	private post(reply: ContentReply): void {
		window.postMessage(reply, '*')
	}

	private readonly onMessage = (event: MessageEvent) => {
		const message = event.data as PageMessage | null
		if (event.source !== window || !message || message.vpass !== 'page' || typeof message.id !== 'string') {
			return
		}
		void this.handle(message)
	}

	private async handle(message: PageMessage): Promise<void> {
		const { id } = message
		try {
			switch (message.kind) {
			case 'status':
				this.post({ vpass: 'content', id, enabled: await this.send('passkeyProvider', {}) })
				return
			case 'conditional':
				this.conditional = { id, options: message.options }
				this.post({ vpass: 'content', id, ack: true })
				return
			case 'abort':
				if (this.conditional?.id === id) {
					this.conditional = null
				} else {
					await this.send('fido2Abort', { requestId: id })
				}
				return
			case 'create':
			case 'get': {
				this.post({ vpass: 'content', id, ack: true })
				const reply = message.kind === 'create'
					? await this.send('fido2Create', { requestId: id, options: message.options })
					: await this.send('fido2Get', { requestId: id, options: message.options, credentialId: null })
				if (reply.status !== 'pending') {
					this.post({ vpass: 'content', id, result: reply })
				}
				return
			}
			}
		} catch {
			// Extension reloaded or unavailable: let the browser handle it.
			if (message.kind === 'status') {
				this.post({ vpass: 'content', id, enabled: false })
			} else if (message.kind !== 'abort') {
				this.post({ vpass: 'content', id, result: fallback })
			}
		}
	}

	/** Result of a request the user answered in the V-Pass window. */
	deliver(requestId: string, result: Fido2Result): void {
		this.post({ vpass: 'content', id: requestId, result })
	}

	/** The user picked a passkey in the inline menu: answer the conditional request with it. */
	async passkeyChosen(credentialId: string): Promise<void> {
		const pending = this.conditional
		if (!pending) {
			return
		}
		this.conditional = null
		let result: Fido2Result
		try {
			const reply = await this.send('fido2Get', { requestId: pending.id, options: pending.options, credentialId })
			result = reply.status === 'pending' ? fallback : reply
		} catch {
			result = { status: 'error', name: 'NotAllowedError', message: 'V-Pass is unavailable' }
		}
		this.post({ vpass: 'content', id: pending.id, result })
	}

	destroy(): void {
		window.removeEventListener('message', this.onMessage)
	}
}
