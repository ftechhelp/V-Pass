import Crypto
import CryptoExtras
import Foundation
import XCTest
@testable import VPassKit

/// Cross-language proof: every value in Fixtures/vectors.json was produced by the
/// TypeScript core (`npm run vectors:ios`); the Swift port must open, reproduce or
/// verify each one.
final class VectorTests: XCTestCase {
	static let vectors: JSONValue = {
		let url = Bundle.module.url(forResource: "vectors", withExtension: "json", subdirectory: "Fixtures")!
		return try! JSONValue.parse(Data(contentsOf: url))
	}()

	var v: JSONValue { Self.vectors }

	func hex(_ text: String?) -> Bytes {
		let chars = Array(text ?? "")
		return stride(from: 0, to: chars.count, by: 2).map { UInt8(String(chars[$0..<$0 + 2]), radix: 16)! }
	}

	func decode<T: Decodable>(_ type: T.Type, _ json: JSONValue?) throws -> T {
		try JSONDecoder().decode(T.self, from: XCTUnwrap(json).serializedData())
	}

	func testEncoding() throws {
		for case let entry in v["encoding"]!.arrayValue! {
			let bytes = hex(entry["hex"]?.stringValue)
			XCTAssertEqual(b64urlEncode(bytes), entry["b64url"]?.stringValue)
			XCTAssertEqual(try b64urlDecode(entry["b64url"]!.stringValue!), bytes)
			XCTAssertEqual(base32Encode(bytes), entry["base32"]?.stringValue)
			XCTAssertEqual(try base32Decode(entry["base32"]!.stringValue!), bytes)
		}
		XCTAssertThrowsError(try b64urlDecode("a+b/"))
		XCTAssertThrowsError(try b64urlDecode("abcde"))
	}

	func testArgon2idWithNFKC() throws {
		let kdf = v["kdf"]!
		let params = try decode(KdfParams.self, kdf["params"])
		let masterKey = try deriveMasterKey(kdf["password"]!.stringValue!, params: params)
		XCTAssertEqual(hexEncode(masterKey), kdf["masterKey"]?.stringValue)
		XCTAssertEqual(hexEncode(deriveSubkey(masterKey, context: KDFContext.keyEncryptionKey)), kdf["kek"]?.stringValue)
	}

	func testSubkeys() {
		for entry in v["subkeys"]!.arrayValue! {
			let subkey = deriveSubkey(hex(entry["root"]?.stringValue), context: entry["context"]!.stringValue!, subkeyId: UInt64(entry["subkeyId"]!.intValue!))
			XCTAssertEqual(hexEncode(subkey), entry["subkey"]?.stringValue)
		}
	}

	func testEnvelopesSealedByCore() throws {
		for entry in v["envelopes"]!.arrayValue! {
			let key = hex(entry["key"]?.stringValue)
			let envelope = entry["envelope"]!.stringValue!
			let aad = entry["aad"]!.stringValue!
			XCTAssertTrue(isEnvelope(envelope))
			XCTAssertEqual(try utf8Decode(open(key, envelope, aad: aad)), entry["plaintext"]?.stringValue)
			XCTAssertThrowsError(try open(key, envelope, aad: aad + "x")) { XCTAssertTrue($0 is DecryptionError) }
		}
	}

	func testVaultUnlock() throws {
		let vault = v["vault"]!
		let keyset = try decode(VaultKeyset.self, vault["keyset"])
		let vaultKey = try unlockWithPassword(vault["password"]!.stringValue!, kdf: keyset.kdf, wrappedVaultKey: keyset.wrappedVaultKey)
		XCTAssertEqual(hexEncode(vaultKey), vault["vaultKey"]?.stringValue)
		XCTAssertThrowsError(try unlockWithPassword("wrong", kdf: keyset.kdf, wrappedVaultKey: keyset.wrappedVaultKey)) {
			XCTAssertTrue($0 is WrongPasswordError)
		}
		for typed in [vault["recoveryKey"]!.stringValue!, vault["recoveryKeyTyped"]!.stringValue!] {
			let recovered = try unlockWithRecoveryKey(typed, recoveryWrappedVaultKey: keyset.recoveryWrappedVaultKey)
			XCTAssertEqual(hexEncode(recovered), vault["vaultKey"]?.stringValue)
		}
		XCTAssertEqual(formatRecoveryKey(try parseRecoveryKey(vault["recoveryKey"]!.stringValue!)), vault["recoveryKey"]?.stringValue)
	}

	func testItemsEncryptedByCore() throws {
		let vaultKey = hex(v["vault"]?["vaultKey"]?.stringValue)
		for entry in v["items"]!.arrayValue! {
			let record = try decode(ItemRecord.self, entry["record"])
			let decrypted = try decryptItem(vaultKey: vaultKey, record: record)
			XCTAssertEqual(hexEncode(decrypted.key.bytes), entry["itemKey"]?.stringValue)
			// Same object as core's ItemSchema.parse, unknown fields included.
			XCTAssertEqual(decrypted.item.json, entry["parsed"])
			XCTAssertEqual(itemDisplayTitle(decrypted.item), entry["title"]?.stringValue)
			XCTAssertEqual(itemSubtitle(decrypted.item), entry["subtitle"]?.stringValue)
			XCTAssertEqual(itemSearchText(decrypted.item), entry["searchText"]?.stringValue)

			// Re-encrypting with the same item key round-trips to the same JSON.
			let again = try encryptItem(vaultKey: vaultKey, id: record.id, item: decrypted.item, itemKey: decrypted.key)
			XCTAssertEqual(again.object.wrappedKey.isEmpty, false)
			var reRecord = record
			reRecord.wrappedKey = again.object.wrappedKey
			reRecord.data = again.object.data
			XCTAssertEqual(try decryptItem(vaultKey: vaultKey, record: reRecord).item, decrypted.item)
		}
	}

	func testItemsBoundToTheirId() throws {
		let vaultKey = hex(v["vault"]?["vaultKey"]?.stringValue)
		let items = v["items"]!.arrayValue!
		var swapped = try decode(ItemRecord.self, items[0]["record"])
		swapped.id = try decode(ItemRecord.self, items[1]["record"]).id
		XCTAssertThrowsError(try decryptItem(vaultKey: vaultKey, record: swapped)) { XCTAssertTrue($0 is ItemDecodeError) }
	}

	func testInvalidItemsAreRejectedLikeZod() {
		for json in v["invalidItems"]!.arrayValue! {
			XCTAssertThrowsError(try Item(json: json), json.serialized())
		}
	}

	func testFolder() throws {
		let folder = v["folder"]!
		let decrypted = try decryptFolder(vaultKey: hex(v["vault"]?["vaultKey"]?.stringValue), record: decode(FolderRecord.self, folder["record"]))
		XCTAssertEqual(decrypted.folder.name, folder["name"]?.stringValue)
	}

	func testAttachment() throws {
		let attachment = v["attachment"]!
		let record = try decode(AttachmentRecord.self, attachment["record"])
		let (key, meta) = try decryptAttachmentMeta(itemKey: hex(attachment["itemKey"]?.stringValue), record: record)
		XCTAssertEqual(meta, AttachmentMeta(name: "scan.pdf", mimeType: "application/pdf", size: 70_000))
		let content = try decryptAttachmentContent(attachmentKey: key.bytes, id: record.id, blob: b64urlDecode(attachment["blob"]!.stringValue!))
		XCTAssertEqual(content.count, attachment["contentLength"]?.intValue)
		XCTAssertEqual(content, (0..<70_000).map { UInt8(($0 * 7) & 0xFF) })
	}

	func testPasskeysCreatedByCore() throws {
		for entry in v["passkeys"]!.arrayValue! {
			let passkey = try Passkey(json: entry["passkey"]!)
			let clientDataHash = sha256(utf8Encode("client data"))
			let assertion = try getAssertion(passkey: passkey, rpId: "webauthn.io", clientDataHash: clientDataHash)
			XCTAssertEqual(hexEncode(assertion.authenticatorData), entry["assertionAuthData"]?.stringValue)
			XCTAssertEqual(b64urlEncode(assertion.credentialId), passkey.credentialId)
			XCTAssertEqual(b64urlEncode(assertion.userHandle), passkey.userHandle)

			// The signature verifies with the public key core exported at registration.
			let spki = try b64urlDecode(entry["publicKey"]!.stringValue!)
			let signed = assertion.authenticatorData + clientDataHash
			if passkey.algorithm == es256 {
				let publicKey = try P256.Signing.PublicKey(derRepresentation: spki)
				XCTAssertTrue(publicKey.isValidSignature(try P256.Signing.ECDSASignature(derRepresentation: assertion.signature), for: signed))
			} else {
				let publicKey = try _RSA.Signing.PublicKey(derRepresentation: spki)
				XCTAssertTrue(publicKey.isValidSignature(_RSA.Signing.RSASignature(rawRepresentation: assertion.signature), for: signed, padding: .insecurePKCS1v1_5))
			}

			// A Swift-made passkey for the same RP has the same authenticatorData prefix (rpIdHash ‖ flags ‖ counter).
			let created = try createPasskey(rpId: "webauthn.io", userHandle: utf8Encode("user-1"), userName: "alice", algorithm: passkey.algorithm)
			XCTAssertEqual(hexEncode(Bytes(created.authenticatorData.prefix(37))), entry["registrationAuthDataPrefix"]?.stringValue)
		}
	}

	func testUrlMatching() throws {
		for entry in v["urlMatch"]!.arrayValue! {
			let saved = entry["saved"]!.stringValue!
			let page = entry["page"]!.stringValue!
			let expected = entry["result"]!
			let actual = matchUrl(saved, page)
			if expected.isNull {
				XCTAssertNil(actual, "\(saved) vs \(page)")
			} else {
				XCTAssertEqual(actual?.kind, ["origin": .origin, "host": .host, "domain": .domain][expected["kind"]!.stringValue!], "\(saved) vs \(page)")
				XCTAssertEqual(actual?.insecure, expected["insecure"]?.boolValue, "\(saved) vs \(page)")
			}
		}
		for entry in v["registrableDomain"]!.arrayValue! {
			XCTAssertEqual(registrableDomain(entry["input"]!.stringValue!), entry["output"]?.stringValue, entry["input"]!.stringValue!)
		}
	}

	func testTotp() throws {
		for entry in v["totp"]!.arrayValue! {
			let params = try parseTotp(entry["input"]!.stringValue!)
			let now = Date(timeIntervalSince1970: Double(entry["now"]!.intValue!) / 1000)
			let code = totpCode(params, now: now)
			XCTAssertEqual(code.code, entry["code"]?.stringValue, entry["input"]!.stringValue!)
			XCTAssertEqual(code.remaining, entry["remaining"]?.intValue)
			XCTAssertEqual(params.issuer, entry["issuer"]?.stringValue)
			XCTAssertEqual(params.account, entry["account"]?.stringValue)
		}
	}

	func testCards() {
		for entry in v["cards"]!.arrayValue! {
			let number = entry["number"]!.stringValue!
			XCTAssertEqual(cardBrand(number).rawValue, entry["brand"]?.stringValue, number)
			XCTAssertEqual(luhnValid(number), entry["luhn"]?.boolValue, number)
			XCTAssertEqual(maskCardNumber(number), entry["masked"]?.stringValue, number)
			XCTAssertEqual(formatCardNumber(number), entry["formatted"]?.stringValue, number)
		}
	}

	func testWordlist() {
		XCTAssertEqual(effLargeWordlist.count, v["wordlist"]?["count"]?.intValue)
		XCTAssertEqual(effLargeWordlist.first, v["wordlist"]?["first"]?.stringValue)
		XCTAssertEqual(effLargeWordlist.last, v["wordlist"]?["last"]?.stringValue)
	}
}
