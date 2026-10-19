import Crypto
import Foundation

/// Time-based one-time passwords (RFC 6238 / RFC 4226), as `tools/totp.ts`.
public enum TotpAlgorithm: String, Sendable {
	case sha1 = "SHA1", sha256 = "SHA256", sha512 = "SHA512"
}

public struct TotpParams: Sendable, Equatable {
	public var secret: Bytes
	public var algorithm: TotpAlgorithm
	public var digits: Int
	public var period: Int
	public var issuer: String
	public var account: String
}

public struct InvalidTotpError: Error, LocalizedError, Equatable {
	public let message: String

	public init(_ message: String = "Not a valid authenticator key or otpauth:// link") {
		self.message = message
	}

	public var errorDescription: String? { message }
}

/// Accepts an `otpauth://totp/...` URI or a bare base32 secret (spaces allowed).
public func parseTotp(_ input: String) throws -> TotpParams {
	let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
	if value.isEmpty {
		throw InvalidTotpError("Empty authenticator key")
	}
	if value.lowercased().hasPrefix("otpauth://") {
		return try parseOtpauthUri(value)
	}
	return TotpParams(secret: try decodeSecret(value), algorithm: .sha1, digits: 6, period: 30, issuer: "", account: "")
}

private func decodeSecret(_ value: String) throws -> Bytes {
	let secret: Bytes
	do {
		secret = try base32Decode(value)
	} catch {
		throw InvalidTotpError()
	}
	if secret.count < 5 {
		throw InvalidTotpError("Authenticator key is too short")
	}
	return secret
}

private func parseOtpauthUri(_ uri: String) throws -> TotpParams {
	guard let url = URLComponents(string: uri) else {
		throw InvalidTotpError()
	}
	guard url.host?.lowercased() == "totp" else {
		throw InvalidTotpError("Only time-based (TOTP) codes are supported")
	}
	// Decode like URLSearchParams: "+" means a space.
	let query = url.percentEncodedQueryItems ?? []
	func param(_ name: String) -> String? {
		query.first { $0.name == name }?.value.map { $0.replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? $0 }
	}
	guard let secret = param("secret"), !secret.isEmpty else {
		throw InvalidTotpError("The link has no secret")
	}
	let label = String(url.path.drop { $0 == "/" })
	let labelIssuer: String
	let labelAccount: String
	if let colon = label.firstIndex(of: ":") {
		labelIssuer = String(label[..<colon])
		labelAccount = String(label[label.index(after: colon)...])
	} else {
		labelIssuer = ""
		labelAccount = label
	}
	let algorithmName = (param("algorithm") ?? "SHA1").uppercased()
	guard let algorithm = TotpAlgorithm(rawValue: algorithmName) else {
		throw InvalidTotpError("Unsupported algorithm \(algorithmName)")
	}
	guard let digits = Int(param("digits") ?? "6"), [6, 7, 8].contains(digits),
		let period = Int(param("period") ?? "30"), period >= 1, period <= 300 else {
		throw InvalidTotpError("Unsupported digits or period")
	}
	return TotpParams(
		secret: try decodeSecret(secret),
		algorithm: algorithm,
		digits: digits,
		period: period,
		issuer: param("issuer") ?? labelIssuer,
		account: labelAccount.trimmingCharacters(in: .whitespacesAndNewlines)
	)
}

public func hotp(secret: Bytes, counter: UInt64, algorithm: TotpAlgorithm = .sha1, digits: Int = 6) -> String {
	let key = SymmetricKey(data: secret)
	var message = counter.bigEndian
	let msg = withUnsafeBytes(of: &message) { Data($0) }
	let mac: Bytes
	switch algorithm {
	case .sha1: mac = Bytes(HMAC<Insecure.SHA1>.authenticationCode(for: msg, using: key))
	case .sha256: mac = Bytes(HMAC<SHA256>.authenticationCode(for: msg, using: key))
	case .sha512: mac = Bytes(HMAC<SHA512>.authenticationCode(for: msg, using: key))
	}
	let offset = Int(mac[mac.count - 1] & 0x0F)
	let binary = (UInt32(mac[offset] & 0x7F) << 24) | (UInt32(mac[offset + 1]) << 16) | (UInt32(mac[offset + 2]) << 8) | UInt32(mac[offset + 3])
	var modulus: UInt32 = 1
	for _ in 0..<digits {
		modulus *= 10
	}
	let code = String(binary % modulus)
	return String(repeating: "0", count: max(0, digits - code.count)) + code
}

public struct TotpCode: Sendable, Equatable {
	public var code: String
	/// Seconds until this code expires.
	public var remaining: Int
	public var period: Int
}

public func totpCode(_ params: TotpParams, now: Date = Date()) -> TotpCode {
	let seconds = Int(floor(now.timeIntervalSince1970))
	let counter = UInt64(seconds / params.period)
	return TotpCode(
		code: hotp(secret: params.secret, counter: counter, algorithm: params.algorithm, digits: params.digits),
		remaining: params.period - seconds % params.period,
		period: params.period
	)
}

public func formatTotpCode(_ code: String) -> String {
	switch code.count {
	case 6: "\(code.prefix(3)) \(code.suffix(3))"
	case 8: "\(code.prefix(4)) \(code.suffix(4))"
	default: code
	}
}
