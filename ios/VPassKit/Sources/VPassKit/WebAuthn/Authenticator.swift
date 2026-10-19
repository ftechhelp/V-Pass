import Crypto
import CryptoExtras
import Foundation

/// The software WebAuthn authenticator whose credentials live in the vault
/// (`login.passkeys[]`), as `webauthn/authenticator.ts`, for iOS's credential
/// provider API. iOS has already checked the relying party against the calling
/// site or app and hands over the client-data hash, so this side never sees
/// clientDataJSON.
///
/// - ES256 and RS256 only. The private key is stored as PKCS#8 (base64url) inside
///   the encrypted item, the same format the browser extension writes, so passkeys
///   work across both.
/// - Attestation is always "none" with the V-Pass AAGUID.
/// - Flags: UP, UV, BE and BS (the passkey is synced). The signature counter is
///   always 0, as for other synced passkeys, so syncing between devices never trips
///   a site's clone detection.
public let vpassAAGUID = "ba7969c9-c736-4440-86e6-a7d983855a46"
let aaguidBytes: Bytes = {
	let hex = Array(vpassAAGUID.replacingOccurrences(of: "-", with: ""))
	return stride(from: 0, to: hex.count, by: 2).map { UInt8(String(hex[$0..<$0 + 2]), radix: 16)! }
}()

public let es256 = -7
public let rs256 = -257
let supportedAlgorithms = [es256, rs256]

enum AuthenticatorFlag {
	static let up: UInt8 = 0x01
	static let uv: UInt8 = 0x04
	static let be: UInt8 = 0x08
	static let bs: UInt8 = 0x10
	static let at: UInt8 = 0x40
}

public struct WebAuthnError: Error, LocalizedError, Equatable {
	public enum Kind: Sendable {
		case notAllowed, notSupported, invalidState
	}

	public let kind: Kind
	public let message: String

	public init(_ kind: Kind, _ message: String) {
		self.kind = kind
		self.message = message
	}

	public var errorDescription: String? { message }
}

/* ---------- request helpers ---------- */

/// The first algorithm the site asked for that V-Pass supports (an empty list means ES256/RS256).
public func chooseAlgorithm(_ requested: [Int]) -> Int? {
	(requested.isEmpty ? [es256, rs256] : requested).first { supportedAlgorithms.contains($0) }
}

/// Whether `passkey` answers a get() request for `rpId` (honouring allowCredentials, base64url ids).
public func passkeyMatchesRequest(_ passkey: Passkey, rpId: String, allowCredentials: [String] = []) -> Bool {
	guard passkey.rpId == rpId else {
		return false
	}
	return allowCredentials.isEmpty || allowCredentials.contains(passkey.credentialId)
}

/// Whether a create() request must fail because the vault already holds one of the excluded credentials.
public func isExcluded(_ passkeys: [Passkey], rpId: String, excludeCredentials: [String]) -> Bool {
	guard !excludeCredentials.isEmpty else {
		return false
	}
	let excluded = Set(excludeCredentials)
	return passkeys.contains { $0.rpId == rpId && excluded.contains($0.credentialId) }
}

/* ---------- operations ---------- */

public struct NewPasskey: Sendable {
	public var passkey: Passkey
	public var credentialId: Bytes
	public var authenticatorData: Bytes
	public var attestationObject: Bytes
	/// SubjectPublicKeyInfo (DER).
	public var publicKey: Bytes
}

public struct PasskeyAssertion: Sendable {
	public var credentialId: Bytes
	public var userHandle: Bytes
	public var authenticatorData: Bytes
	public var signature: Bytes
}

public func createPasskey(
	rpId: String,
	rpName: String = "",
	userHandle: Bytes,
	userName: String,
	userDisplayName: String = "",
	algorithm: Int,
	userVerified: Bool = true,
	now: Date = Date()
) throws -> NewPasskey {
	guard supportedAlgorithms.contains(algorithm) else {
		throw WebAuthnError(.notSupported, "None of the key types this site asked for is supported by V-Pass")
	}
	guard (1...64).contains(userHandle.count) else {
		throw WebAuthnError(.notSupported, "user.id must be 1 to 64 bytes")
	}
	let key = try SigningKey.generate(algorithm)
	let credentialId = randomBytes(16)
	let attested = aaguidBytes + [UInt8(credentialId.count >> 8), UInt8(credentialId.count & 0xFF)] + credentialId + (try key.cosePublicKey())
	let flags = AuthenticatorFlag.up | (userVerified ? AuthenticatorFlag.uv : 0) | AuthenticatorFlag.be | AuthenticatorFlag.bs | AuthenticatorFlag.at
	let authData = rpIdHash(rpId) + [flags] + [0, 0, 0, 0] + attested
	let attestationObject = CBOR.map([
		(.text("fmt"), .text("none")),
		(.text("attStmt"), .map([])),
		(.text("authData"), .bytes(authData)),
	]).encoded()
	var pkcs8 = key.pkcs8
	defer { wipe(&pkcs8) }
	let passkey = try Passkey(json: [
		"credentialId": .string(b64urlEncode(credentialId)),
		"rpId": .string(rpId),
		"rpName": .string(rpName),
		"userHandle": .string(b64urlEncode(userHandle)),
		"userName": .string(userName),
		"userDisplayName": .string(userDisplayName),
		"privateKey": .string(b64urlEncode(pkcs8)),
		"algorithm": .int(Int64(algorithm)),
		"signCount": 0,
		"discoverable": true,
		"createdAt": .string(isoTimestamp(now)),
	])
	return NewPasskey(passkey: passkey, credentialId: credentialId, authenticatorData: authData, attestationObject: attestationObject, publicKey: key.spki)
}

public func getAssertion(passkey: Passkey, rpId: String, clientDataHash: Bytes, allowCredentials: [String] = [], userVerified: Bool = true) throws -> PasskeyAssertion {
	guard passkeyMatchesRequest(passkey, rpId: rpId, allowCredentials: allowCredentials) else {
		throw WebAuthnError(.notAllowed, "This passkey cannot be used for this request")
	}
	let flags = AuthenticatorFlag.up | (userVerified ? AuthenticatorFlag.uv : 0) | AuthenticatorFlag.be | AuthenticatorFlag.bs
	let authData = rpIdHash(rpId) + [flags] + [0, 0, 0, 0]
	let key = try SigningKey(passkey: passkey)
	return PasskeyAssertion(
		credentialId: try b64urlDecode(passkey.credentialId),
		userHandle: (try? b64urlDecode(passkey.userHandle)) ?? [],
		authenticatorData: authData,
		signature: try key.sign(authData + clientDataHash)
	)
}

/* ---------- internals ---------- */

func sha256(_ data: Bytes) -> Bytes {
	Bytes(SHA256.hash(data: data))
}

func rpIdHash(_ rpId: String) -> Bytes {
	sha256(utf8Encode(rpId))
}

/// An ES256 or RS256 private key in the PKCS#8 form the vault stores.
struct SigningKey {
	private enum Backing {
		case p256(P256.Signing.PrivateKey)
		case rsa(_RSA.Signing.PrivateKey)
	}

	private let backing: Backing

	static func generate(_ algorithm: Int) throws -> SigningKey {
		algorithm == es256
			? SigningKey(backing: .p256(P256.Signing.PrivateKey()))
			: SigningKey(backing: .rsa(try _RSA.Signing.PrivateKey(keySize: .bits2048)))
	}

	private init(backing: Backing) {
		self.backing = backing
	}

	init(passkey: Passkey) throws {
		let der: Bytes
		do {
			der = try b64urlDecode(passkey.privateKey)
		} catch {
			throw WebAuthnError(.notSupported, "privateKey is not valid base64url")
		}
		switch passkey.algorithm {
		case es256:
			backing = .p256(try P256.Signing.PrivateKey(derRepresentation: der))
		case rs256:
			backing = .rsa(try _RSA.Signing.PrivateKey(derRepresentation: der))
		default:
			throw WebAuthnError(.notSupported, "Passkey algorithm \(passkey.algorithm) is not supported")
		}
	}

	var pkcs8: Bytes {
		switch backing {
		case let .p256(key): Bytes(key.derRepresentation)
		case let .rsa(key): Bytes(key.pkcs8DERRepresentation)
		}
	}

	var spki: Bytes {
		switch backing {
		case let .p256(key): Bytes(key.publicKey.derRepresentation)
		case let .rsa(key): Bytes(key.publicKey.derRepresentation)
		}
	}

	func cosePublicKey() throws -> Bytes {
		switch backing {
		case let .p256(key):
			// kty: EC2, alg: ES256, crv: P-256, x, y (CTAP2 canonical key order)
			let raw = Bytes(key.publicKey.rawRepresentation)
			return CBOR.map([
				(.int(1), .int(2)), (.int(3), .int(es256)), (.int(-1), .int(1)),
				(.int(-2), .bytes(Bytes(raw.prefix(32)))), (.int(-3), .bytes(Bytes(raw.suffix(32)))),
			]).encoded()
		case let .rsa(key):
			// kty: RSA, alg: RS256, n, e
			let primitives = try key.publicKey.getKeyPrimitives()
			return CBOR.map([
				(.int(1), .int(3)), (.int(3), .int(rs256)),
				(.int(-1), .bytes(Bytes(primitives.modulus))), (.int(-2), .bytes(Bytes(primitives.publicExponent))),
			]).encoded()
		}
	}

	/// ES256 signatures are DER (as WebAuthn wants); RS256 are PKCS#1 v1.5.
	func sign(_ data: Bytes) throws -> Bytes {
		switch backing {
		case let .p256(key): Bytes(try key.signature(for: data).derRepresentation)
		case let .rsa(key): Bytes(try key.signature(for: data, padding: .insecurePKCS1v1_5).rawRepresentation)
		}
	}
}
