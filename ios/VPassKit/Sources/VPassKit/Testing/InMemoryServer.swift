import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A minimal in-memory V-Pass server: one vault, items with revisions, 409 on stale
/// writes. For tests and the app's UI-test mode; never used against real data.
public final class InMemoryServer: Transport, @unchecked Sendable {
	private let lock = NSLock()
	public var meta: VaultMeta?
	public var items: [String: ItemRecord] = [:]
	public var folders: [String: FolderRecord] = [:]
	public var revision = 0
	public var offline = false
	public var requests: [String] = []

	public init(meta: VaultMeta?) {
		self.meta = meta
		revision = meta?.revision ?? 0
	}

	public func request(_ req: TransportRequest) async throws -> Data {
		try lock.withLock {
			requests.append("\(req.method.rawValue) \(req.path)")
			if offline {
				throw URLError(.notConnectedToInternet)
			}
			return try handle(req).serializedData()
		}
	}

	private func encode<T: Encodable>(_ value: T) throws -> JSONValue {
		try JSONValue.parse(JSONEncoder().encode(value))
	}

	private func next() -> Int {
		revision += 1
		return revision
	}

	/// Server-side writes from "another device".
	public func otherDeviceUpdates(_ id: String, data: String) {
		lock.withLock {
			items[id]!.data = data
			items[id]!.revision = next()
		}
	}

	private func handle(_ req: TransportRequest) throws -> JSONValue {
		let parts = req.path.split(separator: "/").map(String.init)
		switch (req.method, parts.first, parts.count) {
		case (.get, "vault", 1):
			guard var meta else { throw ApiError(status: 404, message: "No vault") }
			meta.revision = revision
			return try encode(meta)
		case (.get, "sync", 1):
			let since = Int(req.query["since"] ?? "0") ?? 0
			return try encode(SyncResponse(
				revision: revision,
				items: items.values.filter { $0.revision > since }.sorted { $0.revision < $1.revision },
				folders: folders.values.filter { $0.revision > since },
				attachments: [],
				tombstones: []
			))
		case (.post, "items", 1):
			let body = req.json!
			let record = ItemRecord(id: body["id"]!.stringValue!, wrappedKey: body["wrappedKey"]!.stringValue!, data: body["data"]!.stringValue!, revision: next(), createdAt: 100, updatedAt: 100, deletedAt: nil)
			items[record.id] = record
			return try encode(record)
		case (.put, "items", 2):
			let body = req.json!
			guard var record = items[parts[1]] else { throw ApiError(status: 404, message: "Not found") }
			guard body["baseRevision"]?.intValue == record.revision else {
				throw ApiError(status: 409, message: "Conflict", data: ["current": try encode(record)])
			}
			record.wrappedKey = body["wrappedKey"]!.stringValue!
			record.data = body["data"]!.stringValue!
			record.revision = next()
			items[record.id] = record
			return try encode(record)
		case (.post, "items", 3):
			guard var record = items[parts[1]] else { throw ApiError(status: 404, message: "Not found") }
			record.deletedAt = parts[2] == "trash" ? 500 : nil
			record.revision = next()
			items[record.id] = record
			return try encode(record)
		case (.post, "folders", 1):
			let body = req.json!
			let record = FolderRecord(id: body["id"]!.stringValue!, wrappedKey: body["wrappedKey"]!.stringValue!, data: body["data"]!.stringValue!, revision: next(), createdAt: 1, updatedAt: 1)
			folders[record.id] = record
			return try encode(record)
		default:
			throw ApiError(status: 400, message: "Unexpected \(req.method.rawValue) \(req.path)")
		}
	}
}
