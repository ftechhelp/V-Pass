import Clibsodium
import Foundation

/// Argon2id parameters, stored (in the clear) with the vault so they can be raised later.
public struct KdfParams: Codable, Sendable, Equatable {
	public var algorithm: String
	/// Iterations (libsodium opslimit).
	public var opsLimit: Int
	/// Memory in bytes (libsodium memlimit).
	public var memLimit: Int
	/// 16-byte salt, base64url.
	public var salt: String

	public init(algorithm: String = "argon2id", opsLimit: Int, memLimit: Int, salt: String) {
		self.algorithm = algorithm
		self.opsLimit = opsLimit
		self.memLimit = memLimit
		self.salt = salt
	}
}

public let defaultKdfOps = 3
public let defaultKdfMem = 64 * 1024 * 1024

private let minOps = 2
private let maxOps = 20
private let minMem = 32 * 1024 * 1024
private let maxMem = 1024 * 1024 * 1024

public struct KdfParamsError: Error, LocalizedError, Equatable {
	public let message: String
	public var errorDescription: String? { message }
}

public func newKdfParams(opsLimit: Int = defaultKdfOps, memLimit: Int = defaultKdfMem) throws -> KdfParams {
	let params = KdfParams(opsLimit: opsLimit, memLimit: memLimit, salt: b64urlEncode(randomBytes(16)))
	try assertKdfParams(params)
	return params
}

public func assertKdfParams(_ params: KdfParams) throws {
	guard params.algorithm == "argon2id" else {
		throw KdfParamsError(message: "Unsupported KDF algorithm: \(params.algorithm)")
	}
	guard params.opsLimit >= minOps, params.opsLimit <= maxOps else {
		throw KdfParamsError(message: "KDF iterations out of range")
	}
	guard params.memLimit >= minMem, params.memLimit <= maxMem else {
		throw KdfParamsError(message: "KDF memory out of range")
	}
	guard (try? b64urlDecode(params.salt))?.count == 16 else {
		throw KdfParamsError(message: "KDF salt must be 16 bytes")
	}
}

/// Stretch the master password into a 32-byte master key with Argon2id.
/// The password is NFKC-normalised so the same password typed on different
/// keyboards/OSes always yields the same key. Blocks for a few hundred ms.
public func deriveMasterKey(_ password: String, params: KdfParams) throws -> Bytes {
	try assertKdfParams(params)
	sodiumReady()
	// NUL-terminated only so an empty password still has a valid pointer; the length excludes it.
	var passwordBytes = utf8Encode(password.precomposedStringWithCompatibilityMapping) + [0]
	defer { wipe(&passwordBytes) }
	let passwordLength = passwordBytes.count - 1
	let salt = try b64urlDecode(params.salt)
	var key = Bytes(repeating: 0, count: 32)
	let result = passwordBytes.withUnsafeBufferPointer { pw in
		pw.withMemoryRebound(to: CChar.self) { pwChars in
			crypto_pwhash(
				&key, 32,
				pwChars.baseAddress!, UInt64(passwordLength),
				salt,
				UInt64(params.opsLimit), Int(params.memLimit),
				crypto_pwhash_ALG_ARGON2ID13
			)
		}
	}
	guard result == 0 else {
		throw SodiumError("Argon2id failed (not enough memory?)")
	}
	return key
}
