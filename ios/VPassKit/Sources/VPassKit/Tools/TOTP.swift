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
	return try totpParams(
		secret: secret,
		algorithm: param("algorithm"),
		digits: jsNumber(param("digits") ?? "6"),
		period: jsNumber(param("period") ?? "30"),
		issuer: param("issuer") ?? labelIssuer,
		account: labelAccount.trimmingCharacters(in: .whitespacesAndNewlines)
	)
}

/// `Number(text)` for the strings these fields hold: NaN when it isn't a number.
func jsNumber(_ text: String) -> Double {
	let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
	return trimmed.isEmpty ? 0 : Double(trimmed) ?? .nan
}

/// Check the parts of a TOTP setup, as otpauth:// links and other apps' exports
/// hold them (`totpParamsFrom`): the same rules as an otpauth:// link.
public func totpParams(secret: String, algorithm: String? = nil, digits: Double? = nil, period: Double? = nil, issuer: String = "", account: String = "") throws -> TotpParams {
	let algorithmName = (algorithm ?? "SHA1").uppercased()
	guard let algorithm = TotpAlgorithm(rawValue: algorithmName) else {
		throw InvalidTotpError("Unsupported algorithm \(algorithmName)")
	}
	let digits = digits ?? 6
	let period = period ?? 30
	guard [6.0, 7.0, 8.0].contains(digits), period.isFinite, period.rounded() == period, period >= 1, period <= 300 else {
		throw InvalidTotpError("Unsupported digits or period")
	}
	return TotpParams(
		secret: try decodeSecret(secret),
		algorithm: algorithm,
		digits: Int(digits),
		period: Int(period),
		issuer: issuer,
		account: account
	)
}

/// The otpauth:// link for a key (`buildOtpauthUri`), encoded exactly as JavaScript does it.
public func buildOtpauthUri(_ params: TotpParams) -> String {
	let label = encodeURIComponent(params.issuer.isEmpty ? params.account : "\(params.issuer):\(params.account)")
	var query = [("secret", base32Encode(params.secret))]
	if !params.issuer.isEmpty { query.append(("issuer", params.issuer)) }
	if params.algorithm != .sha1 { query.append(("algorithm", params.algorithm.rawValue)) }
	if params.digits != 6 { query.append(("digits", String(params.digits))) }
	if params.period != 30 { query.append(("period", String(params.period))) }
	return "otpauth://totp/\(label)?" + query.map { "\(formEncode($0.0))=\(formEncode($0.1))" }.joined(separator: "&")
}

private func percentEncode(_ text: String, keeping keep: (UInt8) -> Bool, spaceAsPlus: Bool = false) -> String {
	var out = ""
	for byte in text.utf8 {
		if keep(byte) {
			out.append(Character(Unicode.Scalar(byte)))
		} else if spaceAsPlus && byte == 0x20 {
			out.append("+")
		} else {
			out += String(format: "%%%02X", byte)
		}
	}
	return out
}

private func isAlphanumeric(_ byte: UInt8) -> Bool {
	(byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A)
}

/// JavaScript's `encodeURIComponent`: keeps A–Z a–z 0–9 - _ . ! ~ * ' ( )
func encodeURIComponent(_ text: String) -> String {
	percentEncode(text) { isAlphanumeric($0) || Array("-_.!~*'()".utf8).contains($0) }
}

/// `URLSearchParams` serialisation (application/x-www-form-urlencoded): keeps A–Z a–z 0–9 * - . _ and writes spaces as "+".
func formEncode(_ text: String) -> String {
	percentEncode(text, keeping: { isAlphanumeric($0) || Array("*-._".utf8).contains($0) }, spaceAsPlus: true)
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
