import Clibsodium

public let keyBytes = 32

/// AAD labels. Every ciphertext is bound to exactly one of these, so a blob
/// produced for one purpose/object can never be accepted for another.
public enum AAD {
	public static let vaultKeyPassword = "vpass:vk:password"
	public static let vaultKeyRecovery = "vpass:vk:recovery"
	public static func vaultKeyPrf(_ credentialId: String) -> String { "vpass:vk:prf:\(credentialId)" }
	public static func itemKey(_ id: String) -> String { "vpass:item-key:\(id)" }
	public static func item(_ id: String) -> String { "vpass:item:\(id)" }
	public static func folderKey(_ id: String) -> String { "vpass:folder-key:\(id)" }
	public static func folder(_ id: String) -> String { "vpass:folder:\(id)" }
	public static func attachmentKey(_ id: String) -> String { "vpass:attachment-key:\(id)" }
	public static func attachmentMeta(_ id: String) -> String { "vpass:attachment-meta:\(id)" }
	public static func attachmentData(_ id: String) -> String { "vpass:attachment-data:\(id)" }
	public static let backup = "vpass:backup:v1"
}

/// libsodium KDF contexts (exactly 8 bytes each).
public enum KDFContext {
	public static let keyEncryptionKey = "vpassKEK"
	public static let recovery = "vpassRCV"
	public static let prf = "vpassPRF"
	public static let backup = "vpassBKP"
}

public func generateKey() -> Bytes {
	randomBytes(keyBytes)
}

/// Derive a 32-byte subkey from 32 bytes of uniformly random key material (BLAKE2b-based).
public func deriveSubkey(_ rootKey: Bytes, context: String, subkeyId: UInt64 = 1) -> Bytes {
	sodiumReady()
	precondition(rootKey.count == keyBytes, "Root key must be 32 bytes")
	let ctx = Array(context.utf8CString)
	precondition(ctx.count == Int(crypto_kdf_CONTEXTBYTES) + 1, "KDF contexts are exactly 8 bytes")
	var subkey = Bytes(repeating: 0, count: keyBytes)
	_ = crypto_kdf_derive_from_key(&subkey, keyBytes, subkeyId, ctx, rootKey)
	return subkey
}

public func wrapKey(_ wrappingKey: Bytes, _ key: Bytes, aad: String) -> String {
	seal(wrappingKey, key, aad: aad)
}

public func unwrapKey(_ wrappingKey: Bytes, _ wrapped: String, aad: String) throws -> Bytes {
	let key = try open(wrappingKey, wrapped, aad: aad)
	guard key.count == keyBytes else {
		throw DecryptionError("Unwrapped key has the wrong length")
	}
	return key
}

/// A key that zeroes itself when the last reference goes away. Used for keys that
/// outlive a single call (the vault key, decrypted items' keys).
public final class SecretKey: @unchecked Sendable {
	public private(set) var bytes: Bytes

	public init(_ bytes: Bytes) {
		self.bytes = bytes
	}

	deinit {
		wipe(&bytes)
	}
}
