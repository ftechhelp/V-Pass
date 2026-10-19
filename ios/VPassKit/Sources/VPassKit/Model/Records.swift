/// Wire format exchanged with the Nextcloud server (OCS API), as in `model/records.ts`.
/// Every `data`/`meta`/`wrapped*` field is an encrypted envelope; timestamps are unix seconds.
public struct VaultMeta: Codable, Sendable, Equatable {
	public var kdf: KdfParams
	public var wrappedVaultKey: String
	public var recoveryWrappedVaultKey: String
	public var revision: Int
	public var createdAt: Int
	public var updatedAt: Int

	public init(kdf: KdfParams, wrappedVaultKey: String, recoveryWrappedVaultKey: String, revision: Int, createdAt: Int, updatedAt: Int) {
		self.kdf = kdf
		self.wrappedVaultKey = wrappedVaultKey
		self.recoveryWrappedVaultKey = recoveryWrappedVaultKey
		self.revision = revision
		self.createdAt = createdAt
		self.updatedAt = updatedAt
	}
}

public struct ItemRecord: Codable, Sendable, Equatable {
	public var id: String
	public var wrappedKey: String
	public var data: String
	public var revision: Int
	public var createdAt: Int
	public var updatedAt: Int
	/// Set while the item is in the trash.
	public var deletedAt: Int?

	public init(id: String, wrappedKey: String, data: String, revision: Int, createdAt: Int, updatedAt: Int, deletedAt: Int?) {
		self.id = id
		self.wrappedKey = wrappedKey
		self.data = data
		self.revision = revision
		self.createdAt = createdAt
		self.updatedAt = updatedAt
		self.deletedAt = deletedAt
	}

	public func encode(to encoder: Encoder) throws {
		var c = encoder.container(keyedBy: CodingKeys.self)
		try c.encode(id, forKey: .id)
		try c.encode(wrappedKey, forKey: .wrappedKey)
		try c.encode(data, forKey: .data)
		try c.encode(revision, forKey: .revision)
		try c.encode(createdAt, forKey: .createdAt)
		try c.encode(updatedAt, forKey: .updatedAt)
		// Always written (as null) so the cached JSON has the same shape as core's.
		try c.encode(deletedAt, forKey: .deletedAt)
	}
}

public struct FolderRecord: Codable, Sendable, Equatable {
	public var id: String
	public var wrappedKey: String
	public var data: String
	public var revision: Int
	public var createdAt: Int
	public var updatedAt: Int
}

public struct AttachmentRecord: Codable, Sendable, Equatable {
	public var id: String
	public var itemId: String
	public var wrappedKey: String
	/// Encrypted {name, mimeType, size}.
	public var meta: String
	/// Size of the encrypted blob in bytes.
	public var size: Int
	public var revision: Int
	public var createdAt: Int
}

public struct Tombstone: Codable, Sendable, Equatable {
	public enum Kind: String, Codable, Sendable {
		case item, folder, attachment
	}

	public var type: Kind
	public var id: String
	public var revision: Int
}

public struct SyncResponse: Codable, Sendable, Equatable {
	public var revision: Int
	public var items: [ItemRecord]
	public var folders: [FolderRecord]
	public var attachments: [AttachmentRecord]
	public var tombstones: [Tombstone]
}

public struct EncryptedObject: Codable, Sendable, Equatable {
	public var id: String
	public var wrappedKey: String
	public var data: String
}

public struct UpdatePayload: Codable, Sendable, Equatable {
	public var wrappedKey: String
	public var data: String
	public var baseRevision: Int
}
