import Foundation

/// A tiny re-implementation of the Zod schemas in `packages/core/src/model/items.ts`.
/// Objects are "loose": unknown keys are kept as they are, so fields written by a
/// newer client survive a round-trip through this one. Missing fields get the same
/// defaults Zod gives them; a present field of the wrong type is an error, as in Zod.
public struct SchemaError: Error, LocalizedError, Equatable {
	public let path: String
	public let message: String

	public var errorDescription: String? { "\(path): \(message)" }
}

enum FieldKind: Sendable {
	/// `z.string().default('')`
	case text
	/// `z.string()` (required)
	case requiredText
	/// `z.string().nullable().default(null)`
	case nullableText
	/// `z.string().default(() => new Date().toISOString())`
	case timestamp
	/// `z.boolean().default(x)`
	case bool(Bool)
	/// `z.number().int().default(x)`
	case int(Int64, nonnegative: Bool)
	/// `z.array(z.string()).default([])`
	case stringArray
	/// `z.array(<object schema>).default([])`
	case objects(Schema)
	/// `z.enum([...]).catch(x).default(x)`
	case enumCatch([String], String)
}

struct Schema: Sendable {
	let fields: [(String, FieldKind)]

	func normalize(_ value: JSONValue, path: String, now: String) throws -> [String: JSONValue] {
		guard var object = value.objectValue else {
			throw SchemaError(path: path, message: "expected an object")
		}
		for (key, kind) in fields {
			object[key] = try Self.normalizeField(object[key], kind: kind, path: "\(path).\(key)", now: now)
		}
		return object
	}

	private static func normalizeField(_ value: JSONValue?, kind: FieldKind, path: String, now: String) throws -> JSONValue {
		switch kind {
		case .text:
			guard let value else { return "" }
			guard value.stringValue != nil else { throw SchemaError(path: path, message: "expected a string") }
			return value
		case .requiredText:
			guard let value, value.stringValue != nil else { throw SchemaError(path: path, message: "expected a string") }
			return value
		case .nullableText:
			guard let value else { return .null }
			guard value.isNull || value.stringValue != nil else { throw SchemaError(path: path, message: "expected a string or null") }
			return value
		case .timestamp:
			guard let value else { return .string(now) }
			guard value.stringValue != nil else { throw SchemaError(path: path, message: "expected a string") }
			return value
		case let .bool(fallback):
			guard let value else { return .bool(fallback) }
			guard value.boolValue != nil else { throw SchemaError(path: path, message: "expected a boolean") }
			return value
		case let .int(fallback, nonnegative):
			guard let value else { return .int(fallback) }
			guard let number = value.intValue, !nonnegative || number >= 0 else {
				throw SchemaError(path: path, message: nonnegative ? "expected a non-negative integer" : "expected an integer")
			}
			return .int(Int64(number))
		case .stringArray:
			guard let value else { return [] }
			guard let array = value.arrayValue, array.allSatisfy({ $0.stringValue != nil }) else {
				throw SchemaError(path: path, message: "expected an array of strings")
			}
			return value
		case let .objects(schema):
			guard let value else { return [] }
			guard let array = value.arrayValue else { throw SchemaError(path: path, message: "expected an array") }
			return .array(try array.enumerated().map { i, element in
				.object(try schema.normalize(element, path: "\(path)[\(i)]", now: now))
			})
		case let .enumCatch(options, fallback):
			guard let text = value?.stringValue, options.contains(text) else { return .string(fallback) }
			return .string(text)
		}
	}
}

enum Schemas: Sendable {
	static let customField = Schema(fields: [
		("label", .text),
		("type", .enumCatch(["text", "hidden"], "text")),
		("value", .text),
	])

	static let passkey = Schema(fields: [
		("credentialId", .requiredText),
		("rpId", .requiredText),
		("rpName", .text),
		("userHandle", .text),
		("userName", .text),
		("userDisplayName", .text),
		("privateKey", .requiredText),
		("algorithm", .int(-7, nonnegative: false)),
		("signCount", .int(0, nonnegative: true)),
		("discoverable", .bool(true)),
		("createdAt", .timestamp),
	])

	static let passwordHistoryEntry = Schema(fields: [
		("password", .requiredText),
		("changedAt", .requiredText),
	])

	static let common: [(String, FieldKind)] = [
		("schemaVersion", .int(1, nonnegative: false)),
		("title", .text),
		("folderId", .nullableText),
		("favorite", .bool(false)),
		("notes", .text),
		("customFields", .objects(customField)),
		("createdAt", .timestamp),
		("updatedAt", .timestamp),
	]

	static let login = Schema(fields: common + [
		("username", .text),
		("password", .text),
		("urls", .stringArray),
		("totp", .text),
		("passwordChangedAt", .nullableText),
		("passwordHistory", .objects(passwordHistoryEntry)),
		("passkeys", .objects(passkey)),
	])

	static let note = Schema(fields: common)

	static let card = Schema(fields: common + [
		("cardholderName", .text),
		("number", .text),
		("expMonth", .text),
		("expYear", .text),
		("cvc", .text),
		("pin", .text),
		("zip", .text),
	])

	static let identity = Schema(fields: common + [
		("firstName", .text),
		("middleName", .text),
		("lastName", .text),
		("email", .text),
		("phone", .text),
		("company", .text),
		("address1", .text),
		("address2", .text),
		("city", .text),
		("state", .text),
		("zip", .text),
		("country", .text),
		("birthday", .text),
	])

	static let folder = Schema(fields: [
		("schemaVersion", .int(1, nonnegative: false)),
		("name", .text),
	])
}

/// `new Date().toISOString()`: UTC with milliseconds, e.g. `2026-10-19T08:15:30.123Z`.
public func isoTimestamp(_ date: Date = Date()) -> String {
	date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
}
