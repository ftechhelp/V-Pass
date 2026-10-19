import Foundation

public struct NoVaultError: Error, LocalizedError {
	public init() {}
	public var errorDescription: String? { "This Nextcloud account has no V-Pass vault yet. Create it in the V-Pass web app first." }
}

public struct LockedError: Error, LocalizedError {
	public init() {}
	public var errorDescription: String? { "V-Pass is locked" }
}

public struct AppPasswordRejectedError: Error, LocalizedError {
	public init() {}
	public var errorDescription: String? { "Nextcloud rejected V-Pass's app password. Disconnect and connect again." }
}

/// The saved key no longer opens this vault (it was recreated, or the key is stale).
public struct StaleVaultKeyError: Error, LocalizedError {
	public init() {}
	public var errorDescription: String? { "This saved key no longer opens the vault. Unlock with your master password." }
}

/// Saving an edit failed because another device changed the item first. The
/// session already holds the server's copy; `server` is it, decrypted.
public struct EditConflictError: Error, LocalizedError {
	public let server: DecryptedItem
	public var errorDescription: String? { "This item was changed on another device. Its latest version is shown; your edit was not saved." }
}

public struct FolderSummary: Sendable, Hashable, Identifiable {
	public let id: String
	public let name: String
}

public struct VaultSnapshot: Sendable {
	/// Every readable item, trash included.
	public var items: [DecryptedItem]
	public var folders: [FolderSummary]
	public var revision: Int

	public var activeItems: [DecryptedItem] { items.filter { !$0.inTrash } }

	public func folderName(_ id: String?) -> String? {
		guard let id else { return nil }
		return folders.first { $0.id == id }?.name
	}
}

/// The vault as a client sees it: the encrypted cache (persisted, ciphertext only)
/// plus, while unlocked, the vault key and the decrypted items in memory. The
/// same logic as the browser extension's `background/session.ts` and `vault.ts`,
/// shared by the iPhone app and its AutoFill extension.
public actor VaultSession {
	private let api: VPassAPI
	private let store: VaultStore
	private var cache: VaultCache
	private var meta: VaultMeta?
	private var vaultKey: SecretKey?
	private var decrypted: [String: DecryptedItem] = [:]
	private var folderNames: [String: String] = [:]
	private var syncing: Task<VaultCache.SyncChanges, Error>?

	public init(api: VPassAPI, store: VaultStore) {
		self.api = api
		self.store = store
		cache = (try? store.loadCache()) ?? VaultCache()
		meta = try? store.loadMeta()
	}

	public var isUnlocked: Bool { vaultKey != nil }
	public var cachedMeta: VaultMeta? { meta }
	public var revision: Int { cache.revision }

	/// Current vault metadata from the server, falling back to the cached copy when offline.
	/// nil means the account has no vault.
	@discardableResult
	public func refreshMeta() async throws -> VaultMeta? {
		do {
			let fresh = try await api.getVault()
			meta = fresh
			try? store.saveMeta(fresh)
			return fresh
		} catch let error as ApiError where error.status == 401 {
			throw AppPasswordRejectedError()
		} catch {
			if let meta {
				return meta
			}
			throw error
		}
	}

	/// The cached metadata if there is any (so unlocking works offline without waiting for a timeout), else the server's.
	private func requireMeta() async throws -> VaultMeta {
		if let meta {
			return meta
		}
		guard let fresh = try await refreshMeta() else {
			throw NoVaultError()
		}
		return fresh
	}

	/// Argon2id (~1 s). Throws WrongPasswordError. Returns the vault key so the caller can offer Face ID.
	@discardableResult
	public func unlock(password: String) async throws -> SecretKey {
		let cached = try await requireMeta()
		let bytes: Bytes
		do {
			bytes = try unlockWithPassword(password, kdf: cached.kdf, wrappedVaultKey: cached.wrappedVaultKey)
		} catch is WrongPasswordError {
			// The master password may have been changed on another device since the metadata was cached.
			guard let fresh = try? await refreshMeta(), fresh != cached else {
				throw WrongPasswordError()
			}
			bytes = try unlockWithPassword(password, kdf: fresh.kdf, wrappedVaultKey: fresh.wrappedVaultKey)
		}
		let key = SecretKey(bytes)
		setKey(key)
		return key
	}

	@discardableResult
	public func unlock(recoveryKey: String) async throws -> SecretKey {
		let meta = try await requireMeta()
		let key = SecretKey(try unlockWithRecoveryKey(recoveryKey, recoveryWrappedVaultKey: meta.recoveryWrappedVaultKey))
		setKey(key)
		return key
	}

	/// Unlock with a key saved behind Face ID. Checked against the cache, so a key
	/// for an older (deleted and recreated) vault is refused.
	public func unlock(vaultKey bytes: Bytes) throws {
		let key = SecretKey(bytes)
		if let record = cache.items.values.first {
			guard (try? unwrapKey(key.bytes, record.wrappedKey, aad: AAD.itemKey(record.id))) != nil else {
				throw StaleVaultKeyError()
			}
		} else if let record = cache.folders.values.first {
			guard (try? unwrapKey(key.bytes, record.wrappedKey, aad: AAD.folderKey(record.id))) != nil else {
				throw StaleVaultKeyError()
			}
		}
		setKey(key)
	}

	private func setKey(_ key: SecretKey) {
		if vaultKey !== key {
			forget()
		}
		vaultKey = key
	}

	public func lock() {
		vaultKey = nil
		forget()
	}

	/// The unlocked vault key, for saving it behind Face ID when the user turns that on.
	public func currentVaultKey() throws -> SecretKey {
		try requireKey()
	}

	private func forget() {
		decrypted.removeAll()
		folderNames.removeAll()
	}

	private func requireKey() throws -> SecretKey {
		guard let vaultKey else {
			throw LockedError()
		}
		return vaultKey
	}

	/// Pull changes. Works while locked (it only moves ciphertext). If the vault was
	/// deleted or recreated meanwhile, lock and start over.
	@discardableResult
	public func sync() async throws -> VaultCache.SyncChanges {
		if let syncing {
			return try await syncing.value
		}
		let task = Task { try await self.performSync() }
		syncing = task
		defer { syncing = nil }
		return try await task.value
	}

	private func performSync() async throws -> VaultCache.SyncChanges {
		let previous = meta
		let fresh: VaultMeta?
		do {
			fresh = try await api.getVault()
		} catch let error as ApiError where error.status == 401 {
			throw AppPasswordRejectedError()
		}
		meta = fresh
		try? store.saveMeta(fresh)
		if fresh == nil || (previous != nil && previous?.createdAt != fresh?.createdAt) {
			lock()
			cache.clear()
		}
		var changes = VaultCache.SyncChanges()
		if fresh != nil {
			changes = cache.applySync(try await api.sync(since: cache.revision))
		}
		try? store.saveCache(cache)
		return changes
	}

	/// Reload the cache from disk (another process, the app or AutoFill, may have written it).
	public func reloadFromStore() {
		if let stored = try? store.loadCache(), stored.revision >= cache.revision {
			cache = stored
		}
		if let storedMeta = try? store.loadMeta() {
			meta = storedMeta
		}
	}

	/// Every readable item and folder, decrypting only what changed since last time.
	public func snapshot() throws -> VaultSnapshot {
		let key = try requireKey()
		for record in cache.items.values {
			let known = decrypted[record.id]
			if known == nil || known?.revision != record.revision || known?.deletedAt != record.deletedAt {
				decrypted[record.id] = try? decryptItem(vaultKey: key.bytes, record: record)
			}
		}
		for id in decrypted.keys where cache.items[id] == nil {
			decrypted[id] = nil
		}
		folderNames.removeAll()
		for record in cache.folders.values {
			if let folder = try? decryptFolder(vaultKey: key.bytes, record: record) {
				folderNames[record.id] = folder.folder.name
			}
		}
		let folders = folderNames.map { FolderSummary(id: $0.key, name: $0.value) }
			.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
		return VaultSnapshot(items: Array(decrypted.values), folders: folders, revision: cache.revision)
	}

	public func item(_ id: String) throws -> DecryptedItem? {
		_ = try snapshot()
		return decrypted[id]
	}

	/* ----- writes ----- */

	public func createItem(_ item: Item) async throws -> DecryptedItem {
		let key = try requireKey()
		let id = uuid()
		let valid = try item.validated()
		let enc = try encryptItem(vaultKey: key.bytes, id: id, item: valid)
		let record = try await api.createItem(enc.object)
		return track(record, key: enc.key, item: valid)
	}

	/// Save an edit made in the editor, based on the version the editor started from.
	/// On a conflict the server's copy replaces ours and EditConflictError carries it.
	public func save(id: String, base: DecryptedItem, edited: Item) async throws -> DecryptedItem {
		let key = try requireKey()
		let updated = try updateItem(previous: base.item, next: edited)
		let enc = try encryptItem(vaultKey: key.bytes, id: id, item: updated, itemKey: base.key)
		do {
			let record = try await api.updateItem(id: id, UpdatePayload(wrappedKey: enc.object.wrappedKey, data: enc.object.data, baseRevision: base.revision))
			return track(record, key: base.key, item: updated)
		} catch let conflict as ConflictError<ItemRecord> {
			guard let current = conflict.current else {
				throw conflict
			}
			cache.putItem(current)
			try? store.saveCache(cache)
			let server = try decryptItem(vaultKey: key.bytes, record: current)
			decrypted[id] = server
			throw EditConflictError(server: server)
		}
	}

	/// Change one item. `change` gets the current item and returns the new one (or nil
	/// for "nothing to do"). If another device changed it first, `change` is re-applied
	/// once to the server's copy (as the browser extension does).
	public func modifyItem(id: String, _ change: @Sendable (Item) throws -> Item?) async throws -> DecryptedItem {
		let key = try requireKey()
		guard var current = try item(id), !current.inTrash else {
			throw ApiError(status: 404, message: "This item no longer exists")
		}
		for attempt in 0..<2 {
			guard let next = try change(current.item) else {
				return current
			}
			let updated = try updateItem(previous: current.item, next: next)
			let enc = try encryptItem(vaultKey: key.bytes, id: id, item: updated, itemKey: current.key)
			do {
				let record = try await api.updateItem(id: id, UpdatePayload(wrappedKey: enc.object.wrappedKey, data: enc.object.data, baseRevision: current.revision))
				return track(record, key: current.key, item: updated)
			} catch let conflict as ConflictError<ItemRecord> where attempt == 0 && conflict.current != nil {
				let server = conflict.current!
				cache.putItem(server)
				current = try decryptItem(vaultKey: key.bytes, record: server)
				decrypted[id] = current
			}
		}
		throw ConflictError<ItemRecord>(current: nil)
	}

	public func trash(id: String) async throws {
		let record = try await api.trashItem(id: id)
		cache.putItem(record)
		try? store.saveCache(cache)
	}

	public func restore(id: String) async throws {
		let record = try await api.restoreItem(id: id)
		cache.putItem(record)
		try? store.saveCache(cache)
	}

	public func createFolder(name: String) async throws -> String {
		let key = try requireKey()
		let id = uuid()
		let enc = try encryptFolder(vaultKey: key.bytes, id: id, folder: Folder(name: name))
		let record = try await api.createFolder(enc.object)
		cache.putFolder(record)
		try? store.saveCache(cache)
		folderNames[id] = name
		return id
	}

	private func track(_ record: ItemRecord, key: SecretKey, item: Item) -> DecryptedItem {
		cache.putItem(record)
		try? store.saveCache(cache)
		let entry = DecryptedItem(id: record.id, item: item, key: key, revision: record.revision, createdAt: record.createdAt, updatedAt: record.updatedAt, deletedAt: record.deletedAt)
		decrypted[record.id] = entry
		return entry
	}

	/// Forget the vault entirely (disconnect).
	public func erase() {
		lock()
		cache.clear()
		meta = nil
		try? store.saveCache(cache)
		try? store.saveMeta(nil)
	}
}
