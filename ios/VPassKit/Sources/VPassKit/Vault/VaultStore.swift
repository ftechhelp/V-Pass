import Foundation

/// Where a client keeps its encrypted vault state between launches. On iOS the
/// files live in the App Group container so the AutoFill extension reads the same
/// copy. Everything stored here is ciphertext or public vault metadata.
public protocol VaultStore: Sendable {
	func loadCache() throws -> VaultCache?
	func saveCache(_ cache: VaultCache) throws
	func loadMeta() throws -> VaultMeta?
	func saveMeta(_ meta: VaultMeta?) throws
}

public struct FileVaultStore: VaultStore {
	public let directory: URL

	public init(directory: URL) {
		self.directory = directory
	}

	private var cacheURL: URL { directory.appendingPathComponent("vault-cache.json") }
	private var metaURL: URL { directory.appendingPathComponent("vault-meta.json") }

	public func loadCache() throws -> VaultCache? {
		try read(VaultCache.self, from: cacheURL)
	}

	public func saveCache(_ cache: VaultCache) throws {
		try write(cache, to: cacheURL)
	}

	public func loadMeta() throws -> VaultMeta? {
		try read(VaultMeta.self, from: metaURL)
	}

	public func saveMeta(_ meta: VaultMeta?) throws {
		if let meta {
			try write(meta, to: metaURL)
		} else if FileManager.default.fileExists(atPath: metaURL.path) {
			try FileManager.default.removeItem(at: metaURL)
		}
	}

	/// Remove everything (disconnect).
	public func erase() {
		try? FileManager.default.removeItem(at: cacheURL)
		try? FileManager.default.removeItem(at: metaURL)
	}

	private func read<T: Decodable>(_ type: T.Type, from url: URL) throws -> T? {
		guard FileManager.default.fileExists(atPath: url.path) else {
			return nil
		}
		return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
	}

	private func write<T: Encodable>(_ value: T, to url: URL) throws {
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		let data = try JSONEncoder().encode(value)
		#if os(iOS)
		// Readable only while the device is unlocked (the app and AutoFill only run then).
		try data.write(to: url, options: [.atomic, .completeFileProtection])
		#else
		try data.write(to: url, options: .atomic)
		#endif
	}
}

/// In memory, for tests and the UI-test stub.
public final class MemoryVaultStore: VaultStore, @unchecked Sendable {
	private let lock = NSLock()
	private var cache: VaultCache?
	private var meta: VaultMeta?

	public init(cache: VaultCache? = nil, meta: VaultMeta? = nil) {
		self.cache = cache
		self.meta = meta
	}

	public func loadCache() throws -> VaultCache? { lock.withLock { cache } }
	public func saveCache(_ cache: VaultCache) throws { lock.withLock { self.cache = cache } }
	public func loadMeta() throws -> VaultMeta? { lock.withLock { meta } }
	public func saveMeta(_ meta: VaultMeta?) throws { lock.withLock { self.meta = meta } }
}
