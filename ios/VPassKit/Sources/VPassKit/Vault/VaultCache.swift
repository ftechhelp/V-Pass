/// A vault's *encrypted* sync state (`vault/cache.ts`). The app persists it as JSON
/// in the App Group container; it contains only what the server already stores,
/// so it is safe at rest, and it is what the AutoFill extension reads.
public struct VaultCache: Sendable, Equatable {
	/// Revision up to which every change has been received.
	public var revision = 0
	public var items: [String: ItemRecord] = [:]
	public var folders: [String: FolderRecord] = [:]
	public var attachments: [String: AttachmentRecord] = [:]

	public init() {}

	public struct SyncChanges: Sendable, Equatable {
		/// Items created or updated (including moves to and from the trash).
		public var updatedItems: [String] = []
		/// Items deleted for good.
		public var removedItems: [String] = []
	}

	/// Apply a `GET /sync?since=<revision>` response.
	@discardableResult
	public mutating func applySync(_ res: SyncResponse) -> SyncChanges {
		var changes = SyncChanges()
		for record in res.items {
			items[record.id] = record
			changes.updatedItems.append(record.id)
		}
		res.folders.forEach { folders[$0.id] = $0 }
		res.attachments.forEach { attachments[$0.id] = $0 }
		for tombstone in res.tombstones {
			switch tombstone.type {
			case .item:
				items[tombstone.id] = nil
				attachments = attachments.filter { $0.value.itemId != tombstone.id }
				changes.removedItems.append(tombstone.id)
			case .folder:
				folders[tombstone.id] = nil
			case .attachment:
				attachments[tombstone.id] = nil
			}
		}
		revision = max(revision, res.revision)
		return changes
	}

	/// Record the server's answer to one of our own writes. The sync revision only
	/// advances when nothing can have been missed (the write is exactly the next
	/// revision); otherwise the next sync fetches the gap, this record included.
	public mutating func putItem(_ record: ItemRecord) {
		items[record.id] = record
		advance(record.revision)
	}

	public mutating func putFolder(_ record: FolderRecord) {
		folders[record.id] = record
		advance(record.revision)
	}

	private mutating func advance(_ next: Int) {
		if next == revision + 1 {
			revision = next
		}
	}

	public mutating func clear() {
		self = VaultCache()
	}
}

/// Same JSON shape as core's `VaultCacheJSON`: `{ revision, items: [], folders: [], attachments: [] }`.
extension VaultCache: Codable {
	private enum CodingKeys: String, CodingKey {
		case revision, items, folders, attachments
	}

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		revision = try c.decode(Int.self, forKey: .revision)
		items = Dictionary(try c.decode([ItemRecord].self, forKey: .items).map { ($0.id, $0) }, uniquingKeysWith: { $1 })
		folders = Dictionary(try c.decode([FolderRecord].self, forKey: .folders).map { ($0.id, $0) }, uniquingKeysWith: { $1 })
		attachments = Dictionary(try c.decode([AttachmentRecord].self, forKey: .attachments).map { ($0.id, $0) }, uniquingKeysWith: { $1 })
	}

	public func encode(to encoder: Encoder) throws {
		var c = encoder.container(keyedBy: CodingKeys.self)
		try c.encode(revision, forKey: .revision)
		try c.encode(items.values.sorted { $0.id < $1.id }, forKey: .items)
		try c.encode(folders.values.sorted { $0.id < $1.id }, forKey: .folders)
		try c.encode(attachments.values.sorted { $0.id < $1.id }, forKey: .attachments)
	}
}
