import Foundation

public struct DecryptedItem: Sendable {
	public var id: String
	public var item: Item
	/// Per-item key; needed to encrypt/decrypt this item's attachments and to re-encrypt edits.
	public var key: SecretKey
	public var revision: Int
	public var createdAt: Int
	public var updatedAt: Int
	public var deletedAt: Int?

	public init(id: String, item: Item, key: SecretKey, revision: Int, createdAt: Int, updatedAt: Int, deletedAt: Int?) {
		self.id = id
		self.item = item
		self.key = key
		self.revision = revision
		self.createdAt = createdAt
		self.updatedAt = updatedAt
		self.deletedAt = deletedAt
	}

	public var inTrash: Bool { deletedAt != nil }
}

public struct DecryptedFolder: Sendable {
	public var id: String
	public var folder: Folder
	public var key: SecretKey
	public var revision: Int
}

public struct ItemDecodeError: Error, LocalizedError {
	public let id: String
	public let underlying: Error

	public var errorDescription: String? { "Item \(id) could not be decrypted or parsed" }
}

public struct EncryptedItem: Sendable {
	public var object: EncryptedObject
	public var key: SecretKey
}

/// Encrypt an item. Pass the existing item key when updating so attachments stay readable.
public func encryptItem(vaultKey: Bytes, id: String, item: Item, itemKey: SecretKey? = nil) throws -> EncryptedItem {
	let key = itemKey ?? SecretKey(generateKey())
	let valid = try item.validated()
	return EncryptedItem(
		object: EncryptedObject(
			id: id,
			wrappedKey: wrapKey(vaultKey, key.bytes, aad: AAD.itemKey(id)),
			data: sealJSON(key.bytes, valid.json, aad: AAD.item(id))
		),
		key: key
	)
}

public func decryptItem(vaultKey: Bytes, record: ItemRecord) throws -> DecryptedItem {
	do {
		let key = SecretKey(try unwrapKey(vaultKey, record.wrappedKey, aad: AAD.itemKey(record.id)))
		let item = try Item(json: openJSON(key.bytes, record.data, aad: AAD.item(record.id)))
		return DecryptedItem(
			id: record.id,
			item: item,
			key: key,
			revision: record.revision,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
			deletedAt: record.deletedAt
		)
	} catch {
		throw ItemDecodeError(id: record.id, underlying: error)
	}
}

public func encryptFolder(vaultKey: Bytes, id: String, folder: Folder, folderKey: SecretKey? = nil) throws -> (object: EncryptedObject, key: SecretKey) {
	let key = folderKey ?? SecretKey(generateKey())
	let valid = try Folder(json: folder.json)
	return (
		EncryptedObject(
			id: id,
			wrappedKey: wrapKey(vaultKey, key.bytes, aad: AAD.folderKey(id)),
			data: sealJSON(key.bytes, valid.json, aad: AAD.folder(id))
		),
		key
	)
}

public func decryptFolder(vaultKey: Bytes, record: FolderRecord) throws -> DecryptedFolder {
	let key = SecretKey(try unwrapKey(vaultKey, record.wrappedKey, aad: AAD.folderKey(record.id)))
	return DecryptedFolder(
		id: record.id,
		folder: try Folder(json: openJSON(key.bytes, record.data, aad: AAD.folder(record.id))),
		key: key,
		revision: record.revision
	)
}

public struct AttachmentMeta: Sendable, Equatable {
	public var name: String
	public var mimeType: String
	/// Plaintext size in bytes.
	public var size: Int

	public init(name: String, mimeType: String, size: Int) {
		self.name = name
		self.mimeType = mimeType
		self.size = size
	}

	var json: JSONValue {
		["name": .string(name), "mimeType": .string(mimeType), "size": .int(Int64(size))]
	}
}

public struct EncryptedAttachment: Sendable {
	public var id: String
	public var wrappedKey: String
	public var meta: String
	public var blob: Bytes
}

public func encryptAttachment(itemKey: Bytes, id: String, content: Bytes, meta: AttachmentMeta) -> EncryptedAttachment {
	var key = generateKey()
	defer { wipe(&key) }
	return EncryptedAttachment(
		id: id,
		wrappedKey: wrapKey(itemKey, key, aad: AAD.attachmentKey(id)),
		meta: sealJSON(key, meta.json, aad: AAD.attachmentMeta(id)),
		blob: encryptStream(key, content, aad: AAD.attachmentData(id))
	)
}

public func decryptAttachmentMeta(itemKey: Bytes, record: AttachmentRecord) throws -> (key: SecretKey, meta: AttachmentMeta) {
	let key = SecretKey(try unwrapKey(itemKey, record.wrappedKey, aad: AAD.attachmentKey(record.id)))
	let json = try openJSON(key.bytes, record.meta, aad: AAD.attachmentMeta(record.id))
	return (key, AttachmentMeta(
		name: json["name"]?.stringValue ?? "",
		mimeType: json["mimeType"]?.stringValue ?? "application/octet-stream",
		size: json["size"]?.intValue ?? 0
	))
}

public func decryptAttachmentContent(attachmentKey: Bytes, id: String, blob: Bytes) throws -> Bytes {
	try decryptStream(attachmentKey, blob, aad: AAD.attachmentData(id))
}
