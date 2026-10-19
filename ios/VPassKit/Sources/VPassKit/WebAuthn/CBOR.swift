/// Minimal CBOR encoder (RFC 8949): just enough for COSE public keys and WebAuthn
/// attestation objects (`webauthn/cbor.ts`). Maps keep insertion order, so callers
/// insert keys in CTAP2 canonical order (shorter encodings first) themselves.
public indirect enum CBOR: Sendable, Equatable {
	case int(Int)
	case text(String)
	case bool(Bool)
	case null
	case bytes(Bytes)
	case array([CBOR])
	case map([(CBOR, CBOR)])

	public static func == (a: CBOR, b: CBOR) -> Bool {
		a.encoded() == b.encoded()
	}

	public func encoded() -> Bytes {
		var out = Bytes()
		write(to: &out)
		return out
	}

	private static func header(_ out: inout Bytes, major: UInt8, length: UInt64) {
		let type = major << 5
		switch length {
		case 0..<24:
			out.append(type | UInt8(length))
		case 24..<0x100:
			out += [type | 24, UInt8(length)]
		case 0x100..<0x10000:
			out += [type | 25, UInt8(length >> 8), UInt8(length & 0xFF)]
		case 0x10000..<0x1_0000_0000:
			out += [type | 26] + (0..<4).reversed().map { UInt8((length >> (8 * UInt64($0))) & 0xFF) }
		default:
			out += [type | 27] + (0..<8).reversed().map { UInt8((length >> (8 * UInt64($0))) & 0xFF) }
		}
	}

	private func write(to out: inout Bytes) {
		switch self {
		case let .int(value):
			if value >= 0 {
				Self.header(&out, major: 0, length: UInt64(value))
			} else {
				Self.header(&out, major: 1, length: UInt64(-1 - value))
			}
		case let .text(value):
			let bytes = Array(value.utf8)
			Self.header(&out, major: 3, length: UInt64(bytes.count))
			out += bytes
		case let .bool(value):
			out.append(value ? 0xF5 : 0xF4)
		case .null:
			out.append(0xF6)
		case let .bytes(value):
			Self.header(&out, major: 2, length: UInt64(value.count))
			out += value
		case let .array(values):
			Self.header(&out, major: 4, length: UInt64(values.count))
			values.forEach { $0.write(to: &out) }
		case let .map(pairs):
			Self.header(&out, major: 5, length: UInt64(pairs.count))
			for (key, value) in pairs {
				key.write(to: &out)
				value.write(to: &out)
			}
		}
	}
}
