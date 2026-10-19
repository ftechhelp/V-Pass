import Foundation

/// Ciphertext failed authentication: wrong key, tampered data, or mismatched AAD.
public struct DecryptionError: Error, LocalizedError, Equatable {
	public let message: String

	public init(_ message: String = "Decryption failed") {
		self.message = message
	}

	public var errorDescription: String? { message }
}

public struct WrongPasswordError: Error, LocalizedError, Equatable {
	public init() {}

	public var errorDescription: String? { "Incorrect master password" }
}

public struct InvalidRecoveryKeyError: Error, LocalizedError, Equatable {
	public enum Reason: Sendable {
		case format, checksum, mismatch
	}

	public let reason: Reason

	public init(_ reason: Reason) {
		self.reason = reason
	}

	public var errorDescription: String? {
		reason == .mismatch
			? "This recovery key does not belong to this vault"
			: "This recovery key is not valid. Check it for typos."
	}
}

public struct EncodingError: Error, LocalizedError, Equatable {
	public let message: String

	public init(_ message: String) {
		self.message = message
	}

	public var errorDescription: String? { message }
}

/// libsodium refused an operation (for example Argon2id could not allocate its memory).
public struct SodiumError: Error, LocalizedError, Equatable {
	public let message: String

	public init(_ message: String) {
		self.message = message
	}

	public var errorDescription: String? { message }
}
