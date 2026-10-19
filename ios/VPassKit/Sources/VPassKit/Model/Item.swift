import Foundation

/// Vault item payloads (see `packages/core/src/model/items.ts`). Everything here is
/// encrypted client-side; the server only sees an opaque envelope.
public enum ItemType: String, CaseIterable, Sendable, Codable, Identifiable {
	case login, note, card, identity

	public var id: String { rawValue }
}

/// A decrypted item: the JSON object as stored, with typed accessors on top.
/// Unknown keys are kept, so editing an item here never drops what a newer
/// client wrote.
public struct Item: Sendable, Equatable {
	public private(set) var raw: [String: JSONValue]

	/// Parse and apply the schema defaults (`ItemSchema.parse`).
	public init(json: JSONValue, now: Date = Date()) throws {
		guard let typeName = json["type"]?.stringValue, let type = ItemType(rawValue: typeName) else {
			throw SchemaError(path: "item.type", message: "unknown item type")
		}
		raw = try Self.schema(for: type).normalize(json, path: "item", now: isoTimestamp(now))
	}

	/// `newItem(type)`: an empty item with fresh timestamps.
	public static func new(_ type: ItemType, now: Date = Date()) -> Item {
		let stamp = isoTimestamp(now)
		// Cannot fail: every field is either set here or defaulted.
		return try! Item(json: ["type": .string(type.rawValue), "createdAt": .string(stamp), "updatedAt": .string(stamp)], now: now)
	}

	static func schema(for type: ItemType) -> Schema {
		switch type {
		case .login: Schemas.login
		case .note: Schemas.note
		case .card: Schemas.card
		case .identity: Schemas.identity
		}
	}

	public var json: JSONValue { .object(raw) }

	/// Re-validate after edits (as `ItemSchema.parse` does before every encryption).
	public func validated() throws -> Item {
		try Item(json: json)
	}

	public var type: ItemType { ItemType(rawValue: raw["type"]?.stringValue ?? "") ?? .note }

	/// Any string field by name (card and identity fields, mostly). Missing fields read as "".
	public func text(_ key: String) -> String {
		raw[key]?.stringValue ?? ""
	}

	public mutating func setText(_ key: String, _ value: String) {
		raw[key] = .string(value)
	}

	/* ----- common ----- */

	public var title: String {
		get { text("title") }
		set { setText("title", newValue) }
	}

	public var notes: String {
		get { text("notes") }
		set { setText("notes", newValue) }
	}

	public var folderId: String? {
		get { raw["folderId"]?.stringValue }
		set { raw["folderId"] = newValue.map(JSONValue.string) ?? .null }
	}

	public var favorite: Bool {
		get { raw["favorite"]?.boolValue ?? false }
		set { raw["favorite"] = .bool(newValue) }
	}

	public var createdAt: String { text("createdAt") }

	public var updatedAt: String {
		get { text("updatedAt") }
		set { setText("updatedAt", newValue) }
	}

	public var customFields: [CustomField] {
		get { (raw["customFields"]?.arrayValue ?? []).compactMap { $0.objectValue.map(CustomField.init(raw:)) } }
		set { raw["customFields"] = .array(newValue.map { .object($0.raw) }) }
	}

	/* ----- login ----- */

	public var username: String {
		get { text("username") }
		set { setText("username", newValue) }
	}

	public var password: String {
		get { text("password") }
		set { setText("password", newValue) }
	}

	public var urls: [String] {
		get { (raw["urls"]?.arrayValue ?? []).compactMap(\.stringValue) }
		set { raw["urls"] = .array(newValue.map(JSONValue.string)) }
	}

	/// otpauth:// URI (or bare base32 secret).
	public var totp: String {
		get { text("totp") }
		set { setText("totp", newValue) }
	}

	public var passwordChangedAt: String? {
		get { raw["passwordChangedAt"]?.stringValue }
		set { raw["passwordChangedAt"] = newValue.map(JSONValue.string) ?? .null }
	}

	public var passwordHistory: [PasswordHistoryEntry] {
		get { (raw["passwordHistory"]?.arrayValue ?? []).compactMap { $0.objectValue.map(PasswordHistoryEntry.init(raw:)) } }
		set { raw["passwordHistory"] = .array(newValue.map { .object($0.raw) }) }
	}

	public var passkeys: [Passkey] {
		get { (raw["passkeys"]?.arrayValue ?? []).compactMap { $0.objectValue.map(Passkey.init(raw:)) } }
		set { raw["passkeys"] = .array(newValue.map { .object($0.raw) }) }
	}
}

public struct CustomField: Sendable, Equatable, Identifiable {
	public enum Kind: String, Sendable, CaseIterable {
		case text, hidden
	}

	public private(set) var raw: [String: JSONValue]
	/// Local identity for SwiftUI lists; not stored.
	public let id = UUID()

	init(raw: [String: JSONValue]) {
		self.raw = raw
	}

	public init(label: String = "", kind: Kind = .text, value: String = "") {
		raw = ["label": .string(label), "type": .string(kind.rawValue), "value": .string(value)]
	}

	public var label: String {
		get { raw["label"]?.stringValue ?? "" }
		set { raw["label"] = .string(newValue) }
	}

	public var kind: Kind {
		get { Kind(rawValue: raw["type"]?.stringValue ?? "") ?? .text }
		set { raw["type"] = .string(newValue.rawValue) }
	}

	public var value: String {
		get { raw["value"]?.stringValue ?? "" }
		set { raw["value"] = .string(newValue) }
	}

	public static func == (a: CustomField, b: CustomField) -> Bool {
		a.raw == b.raw
	}
}

public struct PasswordHistoryEntry: Sendable, Equatable {
	public private(set) var raw: [String: JSONValue]

	init(raw: [String: JSONValue]) {
		self.raw = raw
	}

	public init(password: String, changedAt: String) {
		raw = ["password": .string(password), "changedAt": .string(changedAt)]
	}

	public var password: String { raw["password"]?.stringValue ?? "" }
	public var changedAt: String { raw["changedAt"]?.stringValue ?? "" }
}

/// A WebAuthn credential (passkey) for a website. `privateKey` is PKCS#8, base64url.
public struct Passkey: Sendable, Equatable {
	public private(set) var raw: [String: JSONValue]

	init(raw: [String: JSONValue]) {
		self.raw = raw
	}

	public init(json: JSONValue, now: Date = Date()) throws {
		raw = try Schemas.passkey.normalize(json, path: "passkey", now: isoTimestamp(now))
	}

	public var credentialId: String { raw["credentialId"]?.stringValue ?? "" }
	public var rpId: String { raw["rpId"]?.stringValue ?? "" }
	public var rpName: String { raw["rpName"]?.stringValue ?? "" }
	/// base64url
	public var userHandle: String { raw["userHandle"]?.stringValue ?? "" }
	public var userName: String { raw["userName"]?.stringValue ?? "" }
	public var userDisplayName: String { raw["userDisplayName"]?.stringValue ?? "" }
	public var privateKey: String { raw["privateKey"]?.stringValue ?? "" }
	/// COSE algorithm: -7 = ES256, -8 = EdDSA, -257 = RS256.
	public var algorithm: Int { raw["algorithm"]?.intValue ?? -7 }
	public var signCount: Int { raw["signCount"]?.intValue ?? 0 }
	public var discoverable: Bool { raw["discoverable"]?.boolValue ?? true }
	public var createdAt: String { raw["createdAt"]?.stringValue ?? "" }
}

public struct Folder: Sendable, Equatable {
	public private(set) var raw: [String: JSONValue]

	public init(json: JSONValue) throws {
		raw = try Schemas.folder.normalize(json, path: "folder", now: isoTimestamp())
	}

	public init(name: String) {
		raw = ["schemaVersion": 1, "name": .string(name)]
	}

	public var json: JSONValue { .object(raw) }

	public var name: String {
		get { raw["name"]?.stringValue ?? "" }
		set { raw["name"] = .string(newValue) }
	}
}

/// Apply an edit, maintaining updatedAt and the login password history (`updateItem` in core).
public func updateItem(previous: Item, next: Item, now: Date = Date()) throws -> Item {
	let stamp = isoTimestamp(now)
	var updated = next
	updated.updatedAt = stamp
	if previous.type == .login, updated.type == .login, previous.password != updated.password {
		updated.passwordChangedAt = stamp
		if !previous.password.isEmpty {
			updated.passwordHistory = Array(([PasswordHistoryEntry(password: previous.password, changedAt: stamp)] + previous.passwordHistory).prefix(20))
		}
	}
	return try updated.validated()
}
