import type { VaultKeyset } from '../crypto/vault.ts'
import type {
	AttachmentRecord,
	EncryptedObject,
	FolderRecord,
	ItemRecord,
	SyncResponse,
	UnlockKeyRecord,
	VaultMeta,
} from '../model/records.ts'

/**
 * Typed client for the V-Pass OCS API (`/ocs/v2.php/apps/vpass/api/v1`).
 *
 * The transport is injected so the same client works in the Nextcloud web app
 * (session cookie + request token) and in the browser extension / desktop client
 * (app password from Login Flow v2 via HTTP Basic auth).
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface TransportRequest {
	method: HttpMethod
	/** Path below the API base, e.g. `/items/abc`. */
	path: string
	query?: Record<string, string | number>
	json?: unknown
	form?: FormData
	responseType?: 'json' | 'arraybuffer'
}

export interface Transport {
	/**
	 * Perform the request and return the unwrapped OCS `data` (or raw bytes for
	 * `arraybuffer`). Must throw ApiError for non-2xx responses.
	 */
	request<T>(req: TransportRequest): Promise<T>
}

export class ApiError extends Error {
	constructor(public readonly status: number, message: string, public readonly data?: unknown) {
		super(message)
		this.name = 'ApiError'
	}
}

/** 409: someone else changed the object first. `current` is the server's version. */
export class ConflictError<T> extends ApiError {
	constructor(public readonly current: T) {
		super(409, 'This entry was changed on another device')
		this.name = 'ConflictError'
	}
}

export interface UpdatePayload {
	wrappedKey: string
	data: string
	baseRevision: number
}

export interface NewUnlockKey {
	credentialId: string
	prfSalt: string
	wrappedVaultKey: string
	label: string
}

export interface AdminSettings {
	hibpEnabled: boolean
	maxAttachmentMb: number
	trashRetentionDays: number
}

export class VPassApi {
	constructor(private readonly transport: Transport) {}

	private req<T>(req: TransportRequest): Promise<T> {
		return this.transport.request<T>(req)
	}

	private async withConflict<T>(req: TransportRequest): Promise<T> {
		try {
			return await this.req<T>(req)
		} catch (e) {
			if (e instanceof ApiError && e.status === 409) {
				throw new ConflictError((e.data as { current?: T } | undefined)?.current)
			}
			throw e
		}
	}

	/* ----- vault ----- */

	async getVault(): Promise<VaultMeta | null> {
		try {
			return await this.req<VaultMeta>({ method: 'GET', path: '/vault' })
		} catch (e) {
			if (e instanceof ApiError && e.status === 404) {
				return null
			}
			throw e
		}
	}

	createVault(keyset: VaultKeyset): Promise<VaultMeta> {
		return this.req({ method: 'POST', path: '/vault', json: keyset })
	}

	updateVaultKeys(patch: Partial<VaultKeyset>): Promise<VaultMeta> {
		return this.req({ method: 'PUT', path: '/vault', json: patch })
	}

	deleteVault(): Promise<void> {
		return this.req({ method: 'DELETE', path: '/vault' })
	}

	sync(since = 0): Promise<SyncResponse> {
		return this.req({ method: 'GET', path: '/sync', query: { since } })
	}

	/* ----- items ----- */

	createItem(item: EncryptedObject): Promise<ItemRecord> {
		return this.withConflict({ method: 'POST', path: '/items', json: item })
	}

	createItems(items: EncryptedObject[]): Promise<{ revision: number, items: ItemRecord[] }> {
		return this.req({ method: 'POST', path: '/items/batch', json: { items } })
	}

	updateItem(id: string, payload: UpdatePayload): Promise<ItemRecord> {
		return this.withConflict({ method: 'PUT', path: `/items/${enc(id)}`, json: payload })
	}

	trashItem(id: string): Promise<ItemRecord> {
		return this.req({ method: 'POST', path: `/items/${enc(id)}/trash` })
	}

	restoreItem(id: string): Promise<ItemRecord> {
		return this.req({ method: 'POST', path: `/items/${enc(id)}/restore` })
	}

	deleteItem(id: string): Promise<{ revision: number }> {
		return this.req({ method: 'DELETE', path: `/items/${enc(id)}` })
	}

	/* ----- folders ----- */

	createFolder(folder: EncryptedObject): Promise<FolderRecord> {
		return this.req({ method: 'POST', path: '/folders', json: folder })
	}

	updateFolder(id: string, payload: UpdatePayload): Promise<FolderRecord> {
		return this.withConflict({ method: 'PUT', path: `/folders/${enc(id)}`, json: payload })
	}

	deleteFolder(id: string): Promise<{ revision: number }> {
		return this.req({ method: 'DELETE', path: `/folders/${enc(id)}` })
	}

	/* ----- attachments ----- */

	uploadAttachment(itemId: string, attachment: { id: string, wrappedKey: string, meta: string, blob: Uint8Array }): Promise<AttachmentRecord> {
		const form = new FormData()
		form.append('id', attachment.id)
		form.append('wrappedKey', attachment.wrappedKey)
		form.append('meta', attachment.meta)
		form.append('file', new Blob([attachment.blob as BlobPart], { type: 'application/octet-stream' }), `${attachment.id}.bin`)
		return this.req({ method: 'POST', path: `/items/${enc(itemId)}/attachments`, form })
	}

	async downloadAttachment(id: string): Promise<Uint8Array> {
		const buffer = await this.req<ArrayBuffer>({ method: 'GET', path: `/attachments/${enc(id)}`, responseType: 'arraybuffer' })
		return new Uint8Array(buffer)
	}

	deleteAttachment(id: string): Promise<{ revision: number }> {
		return this.req({ method: 'DELETE', path: `/attachments/${enc(id)}` })
	}

	/* ----- passkey unlock ----- */

	listUnlockKeys(): Promise<UnlockKeyRecord[]> {
		return this.req({ method: 'GET', path: '/unlock-keys' })
	}

	createUnlockKey(key: NewUnlockKey): Promise<UnlockKeyRecord> {
		return this.req({ method: 'POST', path: '/unlock-keys', json: key })
	}

	deleteUnlockKey(id: number): Promise<void> {
		return this.req({ method: 'DELETE', path: `/unlock-keys/${id}` })
	}

	markUnlockKeyUsed(id: number): Promise<void> {
		return this.req({ method: 'POST', path: `/unlock-keys/${id}/used` })
	}

	/* ----- breach check ----- */

	async breachRange(prefix: string): Promise<string> {
		const res = await this.req<{ range: string }>({ method: 'GET', path: `/breach/range/${enc(prefix.toUpperCase())}` })
		return res.range
	}

	/* ----- admin ----- */

	getAdminSettings(): Promise<AdminSettings> {
		return this.req({ method: 'GET', path: '/admin/settings' })
	}

	updateAdminSettings(settings: Partial<AdminSettings>): Promise<AdminSettings> {
		return this.req({ method: 'PUT', path: '/admin/settings', json: settings })
	}
}

function enc(segment: string): string {
	return encodeURIComponent(segment)
}
