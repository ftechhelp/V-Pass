import Foundation

/// A JSON value with integers kept apart from floating-point numbers, so item
/// payloads round-trip exactly (`schemaVersion: 1`, never `1.0`) and fields this
/// client does not know survive untouched.
///
/// It has its own small parser and serializer: Foundation's JSON APIs blur
/// booleans, integers and doubles differently on Darwin and Linux.
public enum JSONValue: Sendable, Equatable, Hashable {
	case null
	case bool(Bool)
	case int(Int64)
	case double(Double)
	case string(String)
	case array([JSONValue])
	case object([String: JSONValue])

	public var stringValue: String? {
		if case let .string(value) = self { return value }
		return nil
	}

	public var boolValue: Bool? {
		if case let .bool(value) = self { return value }
		return nil
	}

	/// Integers, and doubles without a fractional part (JSON has one number type).
	public var intValue: Int? {
		switch self {
		case let .int(value): return Int(exactly: value)
		case let .double(value): return value.rounded() == value ? Int(exactly: value) : nil
		default: return nil
		}
	}

	public var arrayValue: [JSONValue]? {
		if case let .array(value) = self { return value }
		return nil
	}

	public var objectValue: [String: JSONValue]? {
		if case let .object(value) = self { return value }
		return nil
	}

	public var isNull: Bool { self == .null }

	public subscript(key: String) -> JSONValue? {
		objectValue?[key]
	}

	/// JSON has one number type: `1000` and `1000.0` are the same value.
	public static func == (a: JSONValue, b: JSONValue) -> Bool {
		switch (a, b) {
		case (.null, .null): true
		case let (.bool(x), .bool(y)): x == y
		case let (.int(x), .int(y)): x == y
		case let (.double(x), .double(y)): x == y
		case let (.int(x), .double(y)), let (.double(y), .int(x)): Double(x) == y
		case let (.string(x), .string(y)): x == y
		case let (.array(x), .array(y)): x == y
		case let (.object(x), .object(y)): x == y
		default: false
		}
	}

	public func hash(into hasher: inout Hasher) {
		switch self {
		case .null: hasher.combine(0)
		case let .bool(value): hasher.combine(value)
		case let .int(value): hasher.combine(Double(value))
		case let .double(value): hasher.combine(value)
		case let .string(value): hasher.combine(value)
		case let .array(value): hasher.combine(value)
		case let .object(value): hasher.combine(value)
		}
	}
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByBooleanLiteral,
	ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral, ExpressibleByNilLiteral, ExpressibleByFloatLiteral {
	public init(stringLiteral value: String) { self = .string(value) }
	public init(integerLiteral value: Int64) { self = .int(value) }
	public init(booleanLiteral value: Bool) { self = .bool(value) }
	public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
	public init(dictionaryLiteral elements: (String, JSONValue)...) { self = .object(Dictionary(elements, uniquingKeysWith: { $1 })) }
	public init(nilLiteral: ()) { self = .null }
	public init(floatLiteral value: Double) { self = .double(value) }
}

/* ---------- serializer ---------- */

extension JSONValue {
	/// Compact JSON. Object keys are sorted so the output is deterministic.
	public func serialized() -> String {
		var out = ""
		write(to: &out)
		return out
	}

	public func serializedData() -> Data {
		Data(serialized().utf8)
	}

	private func write(to out: inout String) {
		switch self {
		case .null:
			out += "null"
		case let .bool(value):
			out += value ? "true" : "false"
		case let .int(value):
			out += String(value)
		case let .double(value):
			if value.isFinite {
				out += value.rounded() == value && abs(value) < 1e15 ? String(Int64(value)) : "\(value)"
			} else {
				out += "null"
			}
		case let .string(value):
			Self.writeString(value, to: &out)
		case let .array(values):
			out += "["
			for (i, value) in values.enumerated() {
				if i > 0 { out += "," }
				value.write(to: &out)
			}
			out += "]"
		case let .object(members):
			out += "{"
			for (i, key) in members.keys.sorted().enumerated() {
				if i > 0 { out += "," }
				Self.writeString(key, to: &out)
				out += ":"
				members[key]!.write(to: &out)
			}
			out += "}"
		}
	}

	private static func writeString(_ value: String, to out: inout String) {
		out += "\""
		for scalar in value.unicodeScalars {
			switch scalar {
			case "\"": out += "\\\""
			case "\\": out += "\\\\"
			case "\n": out += "\\n"
			case "\r": out += "\\r"
			case "\t": out += "\\t"
			case "\u{08}": out += "\\b"
			case "\u{0C}": out += "\\f"
			default:
				if scalar.value < 0x20 {
					out += String(format: "\\u%04x", scalar.value)
				} else {
					out.unicodeScalars.append(scalar)
				}
			}
		}
		out += "\""
	}
}

/* ---------- parser ---------- */

public struct JSONParseError: Error, LocalizedError, Equatable {
	public let message: String
	public var errorDescription: String? { "Invalid JSON: \(message)" }
}

extension JSONValue {
	public static func parse(_ text: String) throws -> JSONValue {
		var parser = Parser(bytes: Array(text.utf8))
		parser.skipWhitespace()
		let value = try parser.parseValue(depth: 0)
		parser.skipWhitespace()
		guard parser.atEnd else {
			throw JSONParseError(message: "trailing characters")
		}
		return value
	}

	public static func parse(_ data: Data) throws -> JSONValue {
		guard let text = String(data: data, encoding: .utf8) else {
			throw JSONParseError(message: "not UTF-8")
		}
		return try parse(text)
	}

	private struct Parser {
		let bytes: [UInt8]
		var index = 0

		var atEnd: Bool { index >= bytes.count }

		mutating func skipWhitespace() {
			while index < bytes.count, [0x20, 0x09, 0x0A, 0x0D].contains(bytes[index]) {
				index += 1
			}
		}

		func peek() throws -> UInt8 {
			guard index < bytes.count else {
				throw JSONParseError(message: "unexpected end")
			}
			return bytes[index]
		}

		mutating func expect(_ literal: String) throws {
			for byte in literal.utf8 {
				guard index < bytes.count, bytes[index] == byte else {
					throw JSONParseError(message: "expected \(literal)")
				}
				index += 1
			}
		}

		mutating func parseValue(depth: Int) throws -> JSONValue {
			guard depth < 128 else {
				throw JSONParseError(message: "nested too deeply")
			}
			switch try peek() {
			case UInt8(ascii: "n"):
				try expect("null")
				return .null
			case UInt8(ascii: "t"):
				try expect("true")
				return .bool(true)
			case UInt8(ascii: "f"):
				try expect("false")
				return .bool(false)
			case UInt8(ascii: "\""):
				return .string(try parseString())
			case UInt8(ascii: "["):
				index += 1
				var values: [JSONValue] = []
				skipWhitespace()
				if try peek() == UInt8(ascii: "]") {
					index += 1
					return .array(values)
				}
				while true {
					skipWhitespace()
					values.append(try parseValue(depth: depth + 1))
					skipWhitespace()
					let c = try peek()
					index += 1
					if c == UInt8(ascii: "]") { return .array(values) }
					guard c == UInt8(ascii: ",") else { throw JSONParseError(message: "expected , or ]") }
				}
			case UInt8(ascii: "{"):
				index += 1
				var members: [String: JSONValue] = [:]
				skipWhitespace()
				if try peek() == UInt8(ascii: "}") {
					index += 1
					return .object(members)
				}
				while true {
					skipWhitespace()
					guard try peek() == UInt8(ascii: "\"") else { throw JSONParseError(message: "expected a key") }
					let key = try parseString()
					skipWhitespace()
					try expect(":")
					skipWhitespace()
					members[key] = try parseValue(depth: depth + 1)
					skipWhitespace()
					let c = try peek()
					index += 1
					if c == UInt8(ascii: "}") { return .object(members) }
					guard c == UInt8(ascii: ",") else { throw JSONParseError(message: "expected , or }") }
				}
			default:
				return try parseNumber()
			}
		}

		mutating func parseNumber() throws -> JSONValue {
			let start = index
			var isInteger = true
			if index < bytes.count, bytes[index] == UInt8(ascii: "-") { index += 1 }
			while index < bytes.count {
				let c = bytes[index]
				if c >= 0x30 && c <= 0x39 {
					index += 1
				} else if c == UInt8(ascii: ".") || c == UInt8(ascii: "e") || c == UInt8(ascii: "E") || c == UInt8(ascii: "+") || c == UInt8(ascii: "-") {
					isInteger = false
					index += 1
				} else {
					break
				}
			}
			guard index > start, let text = String(bytes: bytes[start..<index], encoding: .utf8) else {
				throw JSONParseError(message: "unexpected character")
			}
			if isInteger, let value = Int64(text) {
				return .int(value)
			}
			guard let value = Double(text), value.isFinite else {
				throw JSONParseError(message: "bad number \(text)")
			}
			return .double(value)
		}

		mutating func parseHex4() throws -> UInt32 {
			guard index + 4 <= bytes.count, let text = String(bytes: bytes[index..<index + 4], encoding: .ascii), let value = UInt32(text, radix: 16) else {
				throw JSONParseError(message: "bad \\u escape")
			}
			index += 4
			return value
		}

		mutating func parseString() throws -> String {
			index += 1 // opening quote
			var scalars = String.UnicodeScalarView()
			var raw: [UInt8] = []
			func flush() throws {
				if !raw.isEmpty {
					guard let text = String(validating: raw, as: UTF8.self) else {
						throw JSONParseError(message: "invalid UTF-8 in string")
					}
					scalars.append(contentsOf: text.unicodeScalars)
					raw.removeAll()
				}
			}
			while true {
				guard index < bytes.count else {
					throw JSONParseError(message: "unterminated string")
				}
				let c = bytes[index]
				index += 1
				if c == UInt8(ascii: "\"") {
					try flush()
					return String(scalars)
				}
				if c < 0x20 {
					throw JSONParseError(message: "control character in string")
				}
				if c != UInt8(ascii: "\\") {
					raw.append(c)
					continue
				}
				try flush()
				let e = try peek()
				index += 1
				switch e {
				case UInt8(ascii: "\""): scalars.append("\"")
				case UInt8(ascii: "\\"): scalars.append("\\")
				case UInt8(ascii: "/"): scalars.append("/")
				case UInt8(ascii: "b"): scalars.append("\u{08}")
				case UInt8(ascii: "f"): scalars.append("\u{0C}")
				case UInt8(ascii: "n"): scalars.append("\n")
				case UInt8(ascii: "r"): scalars.append("\r")
				case UInt8(ascii: "t"): scalars.append("\t")
				case UInt8(ascii: "u"):
					var code = try parseHex4()
					if code >= 0xD800 && code < 0xDC00,
						index + 6 <= bytes.count, bytes[index] == UInt8(ascii: "\\"), bytes[index + 1] == UInt8(ascii: "u") {
						let save = index
						index += 2
						let low = try parseHex4()
						if low >= 0xDC00 && low < 0xE000 {
							code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
						} else {
							index = save
						}
					}
					// Lone surrogates (possible in JS strings) become U+FFFD.
					scalars.append(Unicode.Scalar(code) ?? "\u{FFFD}")
				default:
					throw JSONParseError(message: "bad escape")
				}
			}
		}
	}
}

/* ---------- Codable bridge (for the typed wire records) ---------- */

extension JSONValue: Codable {
	public init(from decoder: Decoder) throws {
		let container = try decoder.singleValueContainer()
		if container.decodeNil() {
			self = .null
		} else if let value = try? container.decode([String: JSONValue].self) {
			self = .object(value)
		} else if let value = try? container.decode([JSONValue].self) {
			self = .array(value)
		} else if let value = try? container.decode(String.self) {
			self = .string(value)
		} else if let value = try? container.decode(Bool.self) {
			self = .bool(value)
		} else if let value = try? container.decode(Int64.self) {
			self = .int(value)
		} else {
			self = .double(try container.decode(Double.self))
		}
	}

	public func encode(to encoder: Encoder) throws {
		var container = encoder.singleValueContainer()
		switch self {
		case .null: try container.encodeNil()
		case let .bool(value): try container.encode(value)
		case let .int(value): try container.encode(value)
		case let .double(value): try container.encode(value)
		case let .string(value): try container.encode(value)
		case let .array(value): try container.encode(value)
		case let .object(value): try container.encode(value)
		}
	}
}
