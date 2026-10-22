import Foundation

/// Moving one-time codes over from other authenticator apps, on the device
/// (`import/authenticator.ts`): Google Authenticator's export QR codes
/// (otpauth-migration://), lists of otpauth:// links (Ente Auth's export and most
/// other apps), and the unencrypted JSON exports of Aegis, 2FAS and Bitwarden
/// Authenticator. Microsoft Authenticator has no export, so there is nothing to
/// read from it.

/// One code from another app.
public struct AuthenticatorEntry: Sendable, Equatable, Hashable {
	/// The code as an otpauth://totp/… link, which is what a login's `totp` stores.
	public var totp: String
	public var issuer: String
	public var account: String

	public init(totp: String, issuer: String, account: String) {
		self.totp = totp
		self.issuer = issuer
		self.account = account
	}
}

/// A code V-Pass can't use (counter-based, Steam…). Listed so nothing disappears silently.
public struct SkippedAuthenticatorEntry: Sendable, Equatable, Hashable {
	public var issuer: String
	public var account: String
	public var reason: String
}

/// Google Authenticator splits large exports over several QR codes: this one is number `index + 1` of `size`.
public struct AuthenticatorBatch: Sendable, Equatable {
	public var id: Int
	public var index: Int
	public var size: Int
}

public enum AuthenticatorFormat: String, Sendable {
	case googleAuthenticator = "google-authenticator", otpauth, aegis, twoFas = "2fas", bitwarden
}

public struct AuthenticatorExport: Sendable, Equatable {
	public var format: AuthenticatorFormat
	public var entries: [AuthenticatorEntry] = []
	public var skipped: [SkippedAuthenticatorEntry] = []
	public var batches: [AuthenticatorBatch] = []
}

public struct InvalidAuthenticatorExportError: Error, LocalizedError, Equatable {
	public let message: String

	public init(_ message: String = "This isn't an export from an authenticator app") {
		self.message = message
	}

	public var errorDescription: String? { message }
}

private let damaged = "This Google Authenticator code can't be read. Scan it again."
private let counterBased = "Counter-based (HOTP) codes aren't supported"
private let steam = "Steam Guard codes aren't supported"
private let otherKind = "This kind of code isn't supported"

private func encrypted(_ app: String) -> InvalidAuthenticatorExportError {
	InvalidAuthenticatorExportError("This \(app) export is encrypted. Export it again without a password, import that file, then delete it.")
}

private func trimmed(_ text: String) -> String {
	text.trimmingCharacters(in: .whitespacesAndNewlines)
}

/// Whether the text is one of Google Authenticator's "Transfer accounts" QR codes.
public func isGoogleAuthenticatorExport(_ text: String) -> Bool {
	text.firstMatch(of: /^\s*otpauth-migration:\/\//.ignoresCase()) != nil
}

/// Read a scanned QR code, pasted text or exported file. Throws InvalidAuthenticatorExportError.
public func parseAuthenticatorExport(_ text: String) throws -> AuthenticatorExport {
	var value = text
	if value.unicodeScalars.first == "\u{FEFF}" {
		value.unicodeScalars.removeFirst()
	}
	value = trimmed(value)
	if value.hasPrefix("{") {
		guard let json = try? JSONValue.parse(value) else {
			throw InvalidAuthenticatorExportError()
		}
		return try parseJsonExport(json)
	}
	let links = value.matches(of: /otpauth(?:-migration)?:\/\/[^\s"'<>]+/.ignoresCase()).map { String($0.output) }
	if links.isEmpty {
		throw InvalidAuthenticatorExportError()
	}
	var result = AuthenticatorExport(format: .otpauth)
	for link in links {
		if isGoogleAuthenticatorExport(link) {
			result.format = .googleAuthenticator
			try readMigrationLink(link, into: &result)
		} else {
			readOtpauthLink(link, into: &result)
		}
	}
	return result
}

private func entry(from params: TotpParams) -> AuthenticatorEntry {
	var params = params
	params.issuer = trimmed(params.issuer)
	params.account = trimmed(params.account)
	return AuthenticatorEntry(totp: buildOtpauthUri(params), issuer: params.issuer, account: params.account)
}

private func isHotpLink(_ text: String) -> Bool {
	text.firstMatch(of: /^otpauth:\/\/hotp\//.ignoresCase()) != nil
}

private func readOtpauthLink(_ link: String, into result: inout AuthenticatorExport) {
	do {
		result.entries.append(entry(from: try parseTotp(link)))
	} catch {
		let (issuer, account) = labelOf(link)
		let reason = isHotpLink(link) ? counterBased : (error as? InvalidTotpError)?.message ?? InvalidTotpError().message
		result.skipped.append(SkippedAuthenticatorEntry(issuer: issuer, account: account, reason: reason))
	}
}

/// Issuer and account of a link that isn't usable, to say which one was skipped.
private func labelOf(_ link: String) -> (String, String) {
	guard let url = URLComponents(string: link) else {
		return ("", "")
	}
	let label = String(url.path.drop { $0 == "/" })
	var labelIssuer = ""
	var labelAccount = label
	if let colon = label.firstIndex(of: ":") {
		labelIssuer = String(label[..<colon])
		labelAccount = String(label[label.index(after: colon)...])
	}
	let issuer = url.percentEncodedQueryItems?.first { $0.name == "issuer" }?.value.map(formDecode) ?? labelIssuer
	return (trimmed(issuer), trimmed(labelAccount))
}

/// How `URLSearchParams` decodes a value: "+" is a space, then %XX; malformed escapes stay as they are.
private func formDecode(_ text: some StringProtocol) -> String {
	let bytes = Array(text.utf8).map { $0 == 0x2B ? 0x20 : $0 }
	var out = Bytes()
	var i = 0
	func hex(_ byte: UInt8) -> UInt8? {
		switch byte {
		case 0x30...0x39: byte - 0x30
		case 0x41...0x46: byte - 0x41 + 10
		case 0x61...0x66: byte - 0x61 + 10
		default: nil
		}
	}
	while i < bytes.count {
		if bytes[i] == 0x25, i + 2 < bytes.count, let high = hex(bytes[i + 1]), let low = hex(bytes[i + 2]) {
			out.append(high << 4 | low)
			i += 3
		} else {
			out.append(bytes[i])
			i += 1
		}
	}
	return String(decoding: out, as: UTF8.self)
}

/* ---------- Google Authenticator (protobuf MigrationPayload) ---------- */

private enum ProtoValue {
	case varint(UInt64)
	case bytes(Bytes)

	var int32: Int {
		if case let .varint(value) = self {
			return Int(Int32(truncatingIfNeeded: value))
		}
		return 0
	}

	var data: Bytes? {
		if case let .bytes(value) = self {
			return value
		}
		return nil
	}

	func text() throws -> String {
		guard case let .bytes(value) = self else {
			return ""
		}
		guard let text = try? utf8Decode(value) else {
			throw InvalidAuthenticatorExportError(damaged)
		}
		return text
	}
}

/// The varint (wire type 0) and length-delimited (wire type 2) fields of a protobuf message, in order.
private func protoFields(_ bytes: Bytes) throws -> [(field: Int, value: ProtoValue)] {
	var fields: [(field: Int, value: ProtoValue)] = []
	var pos = 0
	func varint() throws -> UInt64 {
		var result: UInt64 = 0
		var shift: UInt64 = 0
		while shift < 70 {
			guard pos < bytes.count else {
				break
			}
			let byte = bytes[pos]
			pos += 1
			result |= UInt64(byte & 0x7F) << shift
			if byte & 0x80 == 0 {
				return result
			}
			shift += 7
		}
		throw InvalidAuthenticatorExportError(damaged)
	}
	while pos < bytes.count {
		let key = try varint()
		let field = Int(key >> 3)
		switch key & 7 {
		case 0:
			fields.append((field, .varint(try varint())))
		case 1:
			pos += 8
		case 2:
			let length = try varint()
			guard length <= UInt64(bytes.count - pos) else {
				throw InvalidAuthenticatorExportError(damaged)
			}
			fields.append((field, .bytes(Array(bytes[pos..<pos + Int(length)]))))
			pos += Int(length)
		case 5:
			pos += 4
		default:
			throw InvalidAuthenticatorExportError(damaged)
		}
		if pos > bytes.count {
			throw InvalidAuthenticatorExportError(damaged)
		}
	}
	return fields
}

/// The link's `data` as `new URL(link).searchParams.get('data')` reads it.
private func migrationData(_ link: String) -> String {
	guard let question = link.firstIndex(of: "?") else {
		return ""
	}
	var query = link[link.index(after: question)...]
	if let hash = query.firstIndex(of: "#") {
		query = query[..<hash]
	}
	for pair in query.split(separator: "&") {
		let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
		if formDecode(parts[0]) == "data" {
			return parts.count > 1 ? formDecode(parts[1]) : ""
		}
	}
	return ""
}

/// Standard base64 as it arrives in the link's query (a "+" may have turned into a space).
private func base64Decode(_ text: String) throws -> Bytes {
	var url = text.replacingOccurrences(of: " ", with: "+")
		.replacingOccurrences(of: "+", with: "-")
		.replacingOccurrences(of: "/", with: "_")
	while url.hasSuffix("=") {
		url.removeLast()
	}
	return try b64urlDecode(url)
}

private func readMigrationLink(_ link: String, into result: inout AuthenticatorExport) throws {
	let payload: Bytes
	do {
		payload = try base64Decode(migrationData(link))
	} catch {
		throw InvalidAuthenticatorExportError(damaged)
	}
	var batch = AuthenticatorBatch(id: 0, index: 0, size: 1)
	for (field, value) in try protoFields(payload) {
		switch field {
		case 1:
			if let bytes = value.data {
				try readMigrationEntry(bytes, into: &result)
			}
		case 3: batch.size = max(1, value.int32)
		case 4: batch.index = value.int32
		case 5: batch.id = value.int32
		default: break
		}
	}
	result.batches.append(batch)
}

private let migrationAlgorithms: [Int: TotpAlgorithm] = [0: .sha1, 1: .sha1, 2: .sha256, 3: .sha512]
private let migrationDigits: [Int: Int] = [0: 6, 1: 6, 2: 8]

private func readMigrationEntry(_ bytes: Bytes, into result: inout AuthenticatorExport) throws {
	var secret = Bytes()
	var name = ""
	var issuer = ""
	var algorithm = 0
	var digits = 0
	var type = 0
	for (field, value) in try protoFields(bytes) {
		switch field {
		case 1: secret = value.data ?? secret
		case 2: name = try value.text()
		case 3: issuer = try value.text()
		case 4: algorithm = value.int32
		case 5: digits = value.int32
		case 6: type = value.int32
		default: break
		}
	}
	// The name is "Issuer:account" or just the account (compared by code point, as JavaScript does).
	issuer = trimmed(issuer)
	var account = trimmed(name)
	let prefix = Array((issuer + ":").unicodeScalars)
	if !issuer.isEmpty, account.unicodeScalars.starts(with: prefix) {
		account = trimmed(String(String.UnicodeScalarView(account.unicodeScalars.dropFirst(prefix.count))))
	} else if issuer.isEmpty, let colon = account.unicodeScalars.firstIndex(of: ":") {
		issuer = trimmed(String(account.unicodeScalars[..<colon]))
		account = trimmed(String(account.unicodeScalars[account.unicodeScalars.index(after: colon)...]))
	}
	func skip(_ reason: String) {
		result.skipped.append(SkippedAuthenticatorEntry(issuer: issuer, account: account, reason: reason))
	}
	if type == 1 {
		skip(counterBased)
	} else if type != 0 && type != 2 {
		skip(otherKind)
	} else if let algorithmName = migrationAlgorithms[algorithm] {
		if let digitCount = migrationDigits[digits] {
			if secret.count < 5 {
				skip("Authenticator key is too short")
			} else {
				result.entries.append(entry(from: TotpParams(secret: secret, algorithm: algorithmName, digits: digitCount, period: 30, issuer: issuer, account: account)))
			}
		} else {
			skip("Unsupported digits or period")
		}
	} else {
		skip(algorithm == 4 ? "MD5 codes aren't supported" : "Unsupported algorithm")
	}
}

/* ---------- JSON exports ---------- */

private func object(_ value: JSONValue?) -> [String: JSONValue] {
	value?.objectValue ?? [:]
}

private func list(_ value: JSONValue?) -> [JSONValue] {
	value?.arrayValue ?? []
}

private func text(_ value: JSONValue?) -> String {
	trimmed(value?.stringValue ?? "")
}

/// Numbers may arrive as JSON numbers or strings; anything else is NaN, which the TOTP checks refuse.
private func number(_ value: JSONValue?) -> Double? {
	switch value {
	case nil, .null?: return nil
	case let .int(n)?: return Double(n)
	case let .double(n)?: return n
	case let .string(s)?:
		if s.isEmpty { return nil }
		let t = trimmed(s)
		return t.isEmpty ? .nan : Double(t) ?? .nan
	default: return .nan
	}
}

private func parseJsonExport(_ json: JSONValue) throws -> AuthenticatorExport {
	let root = object(json)
	if root["db"] != nil && root["header"] != nil {
		return try parseAegis(root)
	}
	if root["services"] != nil || root["servicesEncrypted"] != nil {
		return try parseTwoFas(root)
	}
	if root["items"]?.arrayValue != nil {
		return try parseBitwarden(root)
	}
	throw InvalidAuthenticatorExportError()
}

private func addFields(_ result: inout AuthenticatorExport, type: String, secret: String, algorithm: String?, digits: Double?, period: Double?, issuer: String, account: String) {
	func skip(_ reason: String) {
		result.skipped.append(SkippedAuthenticatorEntry(issuer: issuer, account: account, reason: reason))
	}
	switch type {
	case "hotp": skip(counterBased)
	case "steam": skip(steam)
	case "totp":
		do {
			result.entries.append(entry(from: try totpParams(secret: secret, algorithm: algorithm, digits: digits, period: period, issuer: issuer, account: account)))
		} catch {
			skip((error as? InvalidTotpError)?.message ?? InvalidTotpError().message)
		}
	default: skip(otherKind)
	}
}

private func nonEmpty(_ text: String) -> String? {
	text.isEmpty ? nil : text
}

/// Aegis: `{ version, header: { slots, params }, db: { entries: [...] } }`; `db` is a string when encrypted.
private func parseAegis(_ root: [String: JSONValue]) throws -> AuthenticatorExport {
	if root["db"]?.stringValue != nil {
		throw encrypted("Aegis")
	}
	var result = AuthenticatorExport(format: .aegis)
	for raw in list(object(root["db"])["entries"]) {
		let entry = object(raw)
		let info = object(entry["info"])
		addFields(
			&result,
			type: nonEmpty(text(entry["type"]).lowercased()) ?? "totp",
			secret: text(info["secret"]),
			algorithm: nonEmpty(text(info["algo"])),
			digits: number(info["digits"]),
			period: number(info["period"]),
			issuer: text(entry["issuer"]),
			account: text(entry["name"])
		)
	}
	return result
}

/// 2FAS: `{ services: [{ name, secret, otp: { issuer, account, digits, period, algorithm, tokenType } }] }`.
private func parseTwoFas(_ root: [String: JSONValue]) throws -> AuthenticatorExport {
	let services = list(root["services"])
	if services.isEmpty && !text(root["servicesEncrypted"]).isEmpty {
		throw encrypted("2FAS")
	}
	var result = AuthenticatorExport(format: .twoFas)
	for raw in services {
		let service = object(raw)
		let otp = object(service["otp"])
		addFields(
			&result,
			type: (nonEmpty(text(otp["tokenType"])) ?? "TOTP").lowercased(),
			secret: text(service["secret"]),
			algorithm: nonEmpty(text(otp["algorithm"])),
			digits: number(otp["digits"]),
			period: number(otp["period"]),
			issuer: nonEmpty(text(otp["issuer"])) ?? text(service["name"]),
			account: nonEmpty(text(otp["account"])) ?? text(otp["label"])
		)
	}
	return result
}

/// Bitwarden (Authenticator, or a password manager export): `{ encrypted, items: [{ name, login: { username, totp } }] }`.
private func parseBitwarden(_ root: [String: JSONValue]) throws -> AuthenticatorExport {
	if root["encrypted"]?.boolValue == true {
		throw encrypted("Bitwarden")
	}
	var result = AuthenticatorExport(format: .bitwarden)
	for raw in list(root["items"]) {
		let item = object(raw)
		let login = object(item["login"])
		let totp = text(login["totp"])
		if totp.isEmpty {
			continue
		}
		let issuer = text(item["name"])
		let account = text(login["username"])
		if totp.firstMatch(of: /^steam:\/\//.ignoresCase()) != nil {
			result.skipped.append(SkippedAuthenticatorEntry(issuer: issuer, account: account, reason: steam))
			continue
		}
		do {
			var params = try parseTotp(totp)
			params.issuer = nonEmpty(trimmed(params.issuer)) ?? issuer
			params.account = nonEmpty(trimmed(params.account)) ?? account
			result.entries.append(entry(from: params))
		} catch {
			let reason = isHotpLink(totp) ? counterBased : (error as? InvalidTotpError)?.message ?? InvalidTotpError().message
			result.skipped.append(SkippedAuthenticatorEntry(issuer: issuer, account: account, reason: reason))
		}
	}
	return result
}

/* ---------- collecting several codes and files ---------- */

/// What makes two codes the same: key, algorithm, digits and period (labels may differ).
private func codeIdentity(_ totp: String) -> String? {
	guard let params = try? parseTotp(totp) else {
		return nil
	}
	return "\(base32Encode(params.secret)):\(params.algorithm.rawValue):\(params.digits):\(params.period)"
}

public struct AuthenticatorAddResult: Sendable, Equatable {
	/// Codes that weren't in the import yet.
	public var added: Int
	public var skipped: Int
	/// This exact QR code or text was added before (a camera sees each code many times).
	public var repeated: Bool
}

/// Collects codes from several QR codes, screenshots, files or pastes into one import, each code once.
public struct AuthenticatorImport: Sendable {
	public private(set) var entries: [AuthenticatorEntry] = []
	public private(set) var skipped: [SkippedAuthenticatorEntry] = []
	private var texts = Set<String>()
	private var codes = Set<String>()
	private var batches: [Int: (size: Int, indices: Set<Int>)] = [:]
	private var lastBatch: Int?

	public init() {}

	/// Throws InvalidAuthenticatorExportError.
	@discardableResult
	public mutating func add(_ input: String) throws -> AuthenticatorAddResult {
		let key = trimmed(input)
		if texts.contains(key) {
			return AuthenticatorAddResult(added: 0, skipped: 0, repeated: true)
		}
		let parsed = try parseAuthenticatorExport(key)
		texts.insert(key)
		var added = 0
		for entry in parsed.entries {
			let code = codeIdentity(entry.totp) ?? entry.totp
			if codes.insert(code).inserted {
				entries.append(entry)
				added += 1
			}
		}
		skipped += parsed.skipped
		for batch in parsed.batches {
			var seen = batches[batch.id] ?? (size: batch.size, indices: [])
			seen.indices.insert(batch.index)
			batches[batch.id] = seen
			lastBatch = batch.id
		}
		return AuthenticatorAddResult(added: added, skipped: parsed.skipped.count, repeated: false)
	}

	/// How far through a multi-code Google Authenticator export the scanning is, e.g. 2 of 3.
	public var progress: (scanned: Int, total: Int)? {
		guard let lastBatch, let batch = batches[lastBatch] else {
			return nil
		}
		return (batch.indices.count, batch.size)
	}
}

/* ---------- where each code goes ---------- */

/// add: into a login without a code · replace: over a login's different code (off by default) ·
/// new: a new login · exists: the vault already has this code.
public enum AuthenticatorAction: String, Sendable {
	case add, replace, new, exists
}

public struct AuthenticatorPlanRow: Sendable, Identifiable {
	public var entry: AuthenticatorEntry
	public var action: AuthenticatorAction
	/// The login the code goes into (add, replace) or is already in (exists).
	public var itemId: String?
	/// Whether it is imported unless the user changes it: add and new are, replace and exists aren't.
	public var selected: Bool

	public var id: String { entry.totp }
}

/// Lower-case letters and digits only: "Google LLC" and "google-llc" are the same service.
private func simplify(_ value: String) -> String {
	String(String.UnicodeScalarView(value.lowercased().unicodeScalars.filter { ("a"..."z").contains($0) || ("0"..."9").contains($0) }))
}

/// The login is for the code's service: same title, or a website whose domain is the issuer.
private func issuerMatches(_ login: Item, _ issuer: String) -> Bool {
	let key = simplify(issuer)
	if key.isEmpty {
		return false
	}
	if simplify(login.title) == key {
		return true
	}
	return login.urls.contains { url in
		let domain = registrableDomain(url)
		let first = domain.split(separator: ".", omittingEmptySubsequences: false).first.map(String.init) ?? ""
		return simplify(domain) == key || simplify(first) == key
	}
}

/// Usernames that could be the same account: one is empty, or one contains the other ("octocat" and "octocat@example.com").
private func compatibleAccounts(_ a: String, _ b: String) -> Bool {
	let x = trimmed(a).lowercased()
	let y = trimmed(b).lowercased()
	return x.isEmpty || y.isEmpty || x.contains(y) || y.contains(x)
}

/// Pair each code with a login: a login that already has the same code first,
/// then the login with the same service and username, then the vault's only
/// login for that service if it has no code yet and its username doesn't
/// contradict the code's. Anything else becomes a new login, so no code goes
/// into a login it may not belong to. `items` are the vault's items outside the trash.
public func planAuthenticatorImport(_ entries: [AuthenticatorEntry], items: [(id: String, item: Item)]) -> [AuthenticatorPlanRow] {
	let logins = items.filter { $0.item.type == .login }
	var owners: [String: String] = [:]
	for login in logins {
		if let code = codeIdentity(login.item.totp), owners[code] == nil {
			owners[code] = login.id
		}
	}
	var claimed = Set<String>()
	func into(_ entry: AuthenticatorEntry, _ login: (id: String, item: Item)) -> AuthenticatorPlanRow {
		claimed.insert(login.id)
		return trimmed(login.item.totp).isEmpty
			? AuthenticatorPlanRow(entry: entry, action: .add, itemId: login.id, selected: true)
			: AuthenticatorPlanRow(entry: entry, action: .replace, itemId: login.id, selected: false)
	}
	func forService(_ entry: AuthenticatorEntry) -> [(id: String, item: Item)] {
		logins.filter { issuerMatches($0.item, entry.issuer) }
	}

	var rows: [AuthenticatorPlanRow?] = entries.map { entry in
		guard let code = codeIdentity(entry.totp), let owner = owners[code] else {
			return nil
		}
		claimed.insert(owner)
		return AuthenticatorPlanRow(entry: entry, action: .exists, itemId: owner, selected: false)
	}
	for (i, entry) in entries.enumerated() {
		let account = entry.account.lowercased()
		if rows[i] != nil || account.isEmpty {
			continue
		}
		let same = forService(entry).filter { !claimed.contains($0.id) && trimmed($0.item.username).lowercased() == account }
		if let login = same.first(where: { trimmed($0.item.totp).isEmpty }) ?? same.first {
			rows[i] = into(entry, login)
		}
	}
	for (i, entry) in entries.enumerated() where rows[i] == nil {
		let candidates = forService(entry)
		if candidates.count == 1, let only = candidates.first, !claimed.contains(only.id), trimmed(only.item.totp).isEmpty, compatibleAccounts(entry.account, only.item.username) {
			rows[i] = into(entry, only)
		} else {
			rows[i] = AuthenticatorPlanRow(entry: entry, action: .new, itemId: nil, selected: true)
		}
	}
	return rows.compactMap { $0 }
}

public func planAuthenticatorImport(_ entries: [AuthenticatorEntry], items: [DecryptedItem]) -> [AuthenticatorPlanRow] {
	planAuthenticatorImport(entries, items: items.filter { !$0.inTrash }.map { (id: $0.id, item: $0.item) })
}

/// The login a code without a matching login becomes.
public func newLoginForAuthenticatorEntry(_ entry: AuthenticatorEntry, now: Date = Date()) -> Item {
	var item = Item.new(.login, now: now)
	item.title = nonEmpty(entry.issuer) ?? nonEmpty(entry.account) ?? "One-time code"
	item.username = entry.account
	item.totp = entry.totp
	return item
}
