import type { Envelope, MessageMap, MessageType, Request, Response } from './protocol.ts'

/** Typed `chrome.runtime.sendMessage` to the background; rethrows its errors. */
export async function send<K extends MessageType>(type: K, payload: MessageMap[K][0] = {} as MessageMap[K][0]): Promise<Response<K>> {
	const message = { ...payload, type } as Request<K>
	const reply = await chrome.runtime.sendMessage<Request<K>, Envelope<Response<K>> | undefined>(message)
	if (!reply) {
		throw new Error('V-Pass did not answer. Try again.')
	}
	if (!reply.ok) {
		const error = new Error(reply.error.message)
		error.name = reply.error.name
		throw error
	}
	return reply.value
}
