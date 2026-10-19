import Foundation

/// Typed client for the V-Pass OCS API (`/ocs/v2.php/apps/vpass/api/v1`): the
/// parts of `VPassApi` in `api/client.ts` that the iPhone app uses.
public struct VPassAPI: Sendable {
	private let transport: Transport

	public init(transport: Transport) {
		self.transport = transport
	}

	private func req<T: Decodable>(_ request: TransportRequest, as type: T.Type = T.self) async throws -> T {
		let data = try await transport.request(request)
		return try JSONDecoder().decode(T.self, from: data)
	}

	private func withConflict<T: Decodable & Sendable>(_ request: TransportRequest, as type: T.Type = T.self) async throws -> T {
		do {
			return try await req(request)
		} catch let error as ApiError where error.status == 409 {
			let current = error.data?["current"].flatMap { try? JSONDecoder().decode(T.self, from: $0.serializedData()) }
			throw ConflictError<T>(current: current)
		}
	}

	/* ----- vault ----- */

	/// nil when the account has no vault yet.
	public func getVault() async throws -> VaultMeta? {
		do {
			return try await req(TransportRequest(method: .get, path: "/vault"))
		} catch let error as ApiError where error.status == 404 {
			return nil
		}
	}

	public func sync(since: Int = 0) async throws -> SyncResponse {
		try await req(TransportRequest(method: .get, path: "/sync", query: ["since": String(since)]))
	}

	/* ----- items ----- */

	public func createItem(_ item: EncryptedObject) async throws -> ItemRecord {
		try await withConflict(TransportRequest(method: .post, path: "/items", json: [
			"id": .string(item.id), "wrappedKey": .string(item.wrappedKey), "data": .string(item.data),
		]))
	}

	public func updateItem(id: String, _ payload: UpdatePayload) async throws -> ItemRecord {
		try await withConflict(TransportRequest(method: .put, path: "/items/\(enc(id))", json: [
			"wrappedKey": .string(payload.wrappedKey), "data": .string(payload.data), "baseRevision": .int(Int64(payload.baseRevision)),
		]))
	}

	public func trashItem(id: String) async throws -> ItemRecord {
		try await req(TransportRequest(method: .post, path: "/items/\(enc(id))/trash"))
	}

	public func restoreItem(id: String) async throws -> ItemRecord {
		try await req(TransportRequest(method: .post, path: "/items/\(enc(id))/restore"))
	}

	/* ----- folders ----- */

	public func createFolder(_ folder: EncryptedObject) async throws -> FolderRecord {
		try await req(TransportRequest(method: .post, path: "/folders", json: [
			"id": .string(folder.id), "wrappedKey": .string(folder.wrappedKey), "data": .string(folder.data),
		]))
	}

	/* ----- attachments ----- */

	public func downloadAttachment(id: String) async throws -> Bytes {
		Bytes(try await transport.request(TransportRequest(method: .get, path: "/attachments/\(enc(id))", binaryResponse: true)))
	}
}

private func enc(_ segment: String) -> String {
	// encodeURIComponent's unreserved set (ASCII only).
	let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
	return segment.addingPercentEncoding(withAllowedCharacters: allowed) ?? segment
}
