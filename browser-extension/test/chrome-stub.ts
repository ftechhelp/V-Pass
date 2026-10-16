/**
 * Just enough of the `chrome` API for background modules to be imported in
 * unit tests. Storage is an in-memory map; everything else is inert.
 */
function memoryArea() {
	const data: Record<string, unknown> = {}
	return {
		get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
		set: async (patch: Record<string, unknown>) => {
			Object.assign(data, patch)
		},
		remove: async (keys: string | string[]) => {
			for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]
		},
		clear: async () => {
			for (const key of Object.keys(data)) delete data[key]
		},
	}
}

const noop = () => {}
const event = { addListener: noop, removeListener: noop }

;(globalThis as unknown as { chrome: unknown }).chrome = {
	storage: { local: memoryArea(), session: memoryArea() },
	runtime: { id: 'vpass-test', getURL: (path = '') => `chrome-extension://vpass-test/${path}`, onMessage: event, sendMessage: async () => undefined },
	tabs: { query: async () => [], sendMessage: async () => undefined, onRemoved: event, onUpdated: event, onActivated: event },
	windows: { create: async () => ({ id: 1 }), remove: async () => {}, onRemoved: event },
	action: { setIcon: async () => {}, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
	alarms: { create: async () => {}, clear: async () => true, get: async () => undefined, onAlarm: event },
}

export {}
