import type { AttachmentRecord, FolderRecord, ItemRecord, SyncResponse } from '../model/records.ts'

/**
 * Framework-free holder for a vault's *encrypted* sync state. Clients that keep
 * a local copy (browser extension, desktop) persist it as JSON; it contains
 * only what the server already stores, so it is safe at rest.
 */
export interface VaultCacheJSON {
	revision: number
	items: ItemRecord[]
	folders: FolderRecord[]
	attachments: AttachmentRecord[]
}

export interface SyncChanges {
	/** Items created or updated (including moves to and from the trash). */
	updatedItems: string[]
	/** Items deleted for good. */
	removedItems: string[]
}

export class VaultCache {
	/** Revision up to which every change has been received. */
	revision = 0
	readonly items = new Map<string, ItemRecord>()
	readonly folders = new Map<string, FolderRecord>()
	readonly attachments = new Map<string, AttachmentRecord>()

	static fromJSON(json: VaultCacheJSON | null | undefined): VaultCache {
		const cache = new VaultCache()
		if (json) {
			cache.revision = json.revision
			json.items.forEach((r) => cache.items.set(r.id, r))
			json.folders.forEach((r) => cache.folders.set(r.id, r))
			json.attachments.forEach((r) => cache.attachments.set(r.id, r))
		}
		return cache
	}

	toJSON(): VaultCacheJSON {
		return {
			revision: this.revision,
			items: [...this.items.values()],
			folders: [...this.folders.values()],
			attachments: [...this.attachments.values()],
		}
	}

	/** Apply a `GET /sync?since=<revision>` response. */
	applySync(res: SyncResponse): SyncChanges {
		const changes: SyncChanges = { updatedItems: [], removedItems: [] }
		for (const record of res.items) {
			this.items.set(record.id, record)
			changes.updatedItems.push(record.id)
		}
		res.folders.forEach((r) => this.folders.set(r.id, r))
		res.attachments.forEach((r) => this.attachments.set(r.id, r))
		for (const t of res.tombstones) {
			if (t.type === 'item') {
				this.items.delete(t.id)
				for (const [id, att] of this.attachments) {
					if (att.itemId === t.id) this.attachments.delete(id)
				}
				changes.removedItems.push(t.id)
			} else if (t.type === 'folder') {
				this.folders.delete(t.id)
			} else {
				this.attachments.delete(t.id)
			}
		}
		this.revision = Math.max(this.revision, res.revision)
		return changes
	}

	/**
	 * Record the server's answer to one of our own writes. The sync revision only
	 * advances when nothing can have been missed (the write is exactly the next
	 * revision); otherwise the next sync fetches the gap, this record included.
	 */
	putItem(record: ItemRecord): void {
		this.items.set(record.id, record)
		this.advance(record.revision)
	}

	putFolder(record: FolderRecord): void {
		this.folders.set(record.id, record)
		this.advance(record.revision)
	}

	private advance(revision: number): void {
		if (revision === this.revision + 1) {
			this.revision = revision
		}
	}

	clear(): void {
		this.revision = 0
		this.items.clear()
		this.folders.clear()
		this.attachments.clear()
	}
}
