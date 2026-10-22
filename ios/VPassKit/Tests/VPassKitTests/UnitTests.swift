import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import VPassKit
#if canImport(CoreImage)
import CoreGraphics
import CoreImage
#endif

final class JSONTests: XCTestCase {
	func testRoundTripKeepsIntegersAndUnicode() throws {
		let text = #"{"a":1,"b":2.5,"c":[true,false,null],"d":"é 🔑 \"q\" \\ \n \u0001","e":{"f":-3},"g":1e3}"#
		let value = try JSONValue.parse(text)
		XCTAssertEqual(value["a"], .int(1))
		XCTAssertEqual(value["b"], .double(2.5))
		XCTAssertEqual(value["g"], .double(1000))
		XCTAssertEqual(value["d"]?.stringValue, "é 🔑 \"q\" \\ \n \u{01}")
		XCTAssertEqual(try JSONValue.parse(value.serialized()), value)
		XCTAssertEqual(JSONValue.object(["schemaVersion": 1]).serialized(), #"{"schemaVersion":1}"#)
	}

	func testSurrogatePairsAndLoneSurrogates() throws {
		XCTAssertEqual(try JSONValue.parse(#""\ud83d\udd11""#).stringValue, "🔑")
		XCTAssertEqual(try JSONValue.parse(#""\ud83d x""#).stringValue, "\u{FFFD} x")
	}

	func testRejectsJunk() {
		for junk in ["", "{", "[1,]", "{\"a\" 1}", "tru", "\"unterminated", "1 2", "{\"a\":1}x"] {
			XCTAssertThrowsError(try JSONValue.parse(junk), junk)
		}
	}
}

final class ItemTests: XCTestCase {
	func testNewItemHasDefaultsAndIsoTimestamps() throws {
		let item = Item.new(.login)
		XCTAssertEqual(item.raw["schemaVersion"], .int(1))
		XCTAssertEqual(item.raw["folderId"], .null)
		XCTAssertEqual(item.raw["passwordChangedAt"], .null)
		XCTAssertEqual(item.urls, [])
		XCTAssertNotNil(item.createdAt.wholeMatch(of: /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/), item.createdAt)
	}

	func testUnknownFieldsSurviveEdits() throws {
		var item = try Item(json: ["type": "login", "title": "x", "fromTheFuture": ["deep": [1, 2]]])
		item.title = "y"
		item.username = "me"
		let edited = try updateItem(previous: item, next: item)
		XCTAssertEqual(edited.raw["fromTheFuture"], ["deep": [1, 2]])
		XCTAssertEqual(edited.title, "y")
	}

	func testPasswordHistory() throws {
		var previous = Item.new(.login)
		previous.password = "one"
		var next = previous
		next.password = "two"
		let now = Date(timeIntervalSince1970: 1_800_000_000)
		let updated = try updateItem(previous: previous, next: next, now: now)
		XCTAssertEqual(updated.passwordChangedAt, isoTimestamp(now))
		XCTAssertEqual(updated.passwordHistory.map(\.password), ["one"])
		XCTAssertEqual(updated.updatedAt, isoTimestamp(now))

		// Capped at 20 entries, newest first; an empty old password is not recorded.
		var item = Item.new(.login)
		for i in 0..<25 {
			var change = item
			change.password = "p\(i)"
			item = try updateItem(previous: item, next: change)
		}
		XCTAssertEqual(item.passwordHistory.count, 20)
		XCTAssertEqual(item.passwordHistory.first?.password, "p23")
		XCTAssertFalse(item.passwordHistory.contains { $0.password.isEmpty })
	}

	func testCustomFieldTypeFallsBackToText() throws {
		let item = try Item(json: ["type": "note", "customFields": [["label": "a", "type": "weird"], ["type": "hidden", "value": "s"]]])
		XCTAssertEqual(item.customFields.map(\.kind), [.text, .hidden])
		XCTAssertEqual(item.customFields[0].value, "")
	}

	func testEncryptDecryptRoundTrip() throws {
		let vaultKey = generateKey()
		var item = Item.new(.card)
		item.setText("number", "4111111111111111")
		item.title = "Visa"
		let id = uuid()
		XCTAssertNotNil(id.wholeMatch(of: /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/))
		let enc = try encryptItem(vaultKey: vaultKey, id: id, item: item)
		XCTAssertTrue(isEnvelope(enc.object.data))
		let record = ItemRecord(id: id, wrappedKey: enc.object.wrappedKey, data: enc.object.data, revision: 1, createdAt: 0, updatedAt: 0, deletedAt: nil)
		let decrypted = try decryptItem(vaultKey: vaultKey, record: record)
		XCTAssertEqual(decrypted.item, item)
		XCTAssertEqual(decrypted.key.bytes, enc.key.bytes)
		XCTAssertThrowsError(try decryptItem(vaultKey: generateKey(), record: record))
	}
}

final class CryptoTests: XCTestCase {
	func testCreatedVaultUnlocksBothWays() throws {
		let kdf = try newKdfParams(opsLimit: 2, memLimit: 32 * 1024 * 1024)
		let vault = try createVaultKeys(masterPassword: "pw", kdf: kdf)
		XCTAssertEqual(try unlockWithPassword("pw", kdf: kdf, wrappedVaultKey: vault.keyset.wrappedVaultKey), vault.vaultKey)
		XCTAssertEqual(try unlockWithRecoveryKey(vault.recoveryKey, recoveryWrappedVaultKey: vault.keyset.recoveryWrappedVaultKey), vault.vaultKey)
		XCTAssertEqual(vault.recoveryKey.count, 56 + 13)
	}

	func testRecoveryKeyErrors() throws {
		XCTAssertThrowsError(try parseRecoveryKey("too short")) { XCTAssertEqual(($0 as? InvalidRecoveryKeyError)?.reason, .format) }
		var key = Array(formatRecoveryKey(generateKey()))
		key[0] = key[0] == "A" ? "C" : "A"
		XCTAssertThrowsError(try parseRecoveryKey(String(key))) { XCTAssertEqual(($0 as? InvalidRecoveryKeyError)?.reason, .checksum) }
		let other = try createVaultKeys(masterPassword: "x", kdf: newKdfParams(opsLimit: 2, memLimit: 32 * 1024 * 1024))
		XCTAssertThrowsError(try unlockWithRecoveryKey(formatRecoveryKey(generateKey()), recoveryWrappedVaultKey: other.keyset.recoveryWrappedVaultKey)) {
			XCTAssertEqual(($0 as? InvalidRecoveryKeyError)?.reason, .mismatch)
		}
	}

	func testKdfParamsAreValidated() {
		let salt = b64urlEncode(randomBytes(16))
		XCTAssertThrowsError(try assertKdfParams(KdfParams(algorithm: "scrypt", opsLimit: 3, memLimit: 64 << 20, salt: salt)))
		XCTAssertThrowsError(try assertKdfParams(KdfParams(opsLimit: 1, memLimit: 64 << 20, salt: salt)))
		XCTAssertThrowsError(try assertKdfParams(KdfParams(opsLimit: 3, memLimit: 1 << 20, salt: salt)))
		XCTAssertThrowsError(try assertKdfParams(KdfParams(opsLimit: 3, memLimit: 64 << 20, salt: "AAAA")))
	}

	func testStreamDetectsTamperingAndTruncation() throws {
		let key = generateKey()
		let data = randomBytes(150_000)
		let blob = encryptStream(key, data, aad: "a")
		XCTAssertEqual(try decryptStream(key, blob, aad: "a"), data)
		XCTAssertEqual(try decryptStream(key, encryptStream(key, [], aad: "a"), aad: "a"), [])
		XCTAssertThrowsError(try decryptStream(key, Bytes(blob.dropLast(10)), aad: "a"))
		XCTAssertThrowsError(try decryptStream(key, blob + [1], aad: "a"))
		XCTAssertThrowsError(try decryptStream(key, blob, aad: "b"))
	}
}

final class CacheTests: XCTestCase {
	func record(_ id: String, revision: Int, deletedAt: Int? = nil) -> ItemRecord {
		ItemRecord(id: id, wrappedKey: "k", data: "d", revision: revision, createdAt: 0, updatedAt: 0, deletedAt: deletedAt)
	}

	func testSyncTombstonesAndRevision() throws {
		var cache = VaultCache()
		let attachment = AttachmentRecord(id: "att", itemId: "a", wrappedKey: "k", meta: "m", size: 1, revision: 2, createdAt: 0)
		var changes = cache.applySync(SyncResponse(revision: 3, items: [record("a", revision: 1), record("b", revision: 3)], folders: [], attachments: [attachment], tombstones: []))
		XCTAssertEqual(changes.updatedItems, ["a", "b"])
		XCTAssertEqual(cache.revision, 3)
		changes = cache.applySync(SyncResponse(revision: 4, items: [], folders: [], attachments: [], tombstones: [Tombstone(type: .item, id: "a", revision: 4)]))
		XCTAssertEqual(changes.removedItems, ["a"])
		XCTAssertNil(cache.items["a"])
		XCTAssertTrue(cache.attachments.isEmpty)
		// A stale response never moves the revision backwards.
		cache.applySync(SyncResponse(revision: 2, items: [], folders: [], attachments: [], tombstones: []))
		XCTAssertEqual(cache.revision, 4)
	}

	func testOwnWritesOnlyAdvanceWithoutGaps() {
		var cache = VaultCache()
		cache.revision = 10
		cache.putItem(record("x", revision: 11))
		XCTAssertEqual(cache.revision, 11)
		cache.putItem(record("y", revision: 13))
		XCTAssertEqual(cache.revision, 11)
		XCTAssertNotNil(cache.items["y"])
	}

	func testJSONShapeMatchesCore() throws {
		var cache = VaultCache()
		cache.putItem(record("x", revision: 1))
		let json = try JSONValue.parse(JSONEncoder().encode(cache))
		XCTAssertEqual(json["revision"], 1)
		XCTAssertEqual(json["items"]?.arrayValue?.first?["deletedAt"], .null)
		XCTAssertEqual(json["folders"], [])
		XCTAssertEqual(try JSONDecoder().decode(VaultCache.self, from: JSONEncoder().encode(cache)), cache)
	}
}

/// Replays canned responses and records the requests.
final class StubHTTP: HTTPClient, @unchecked Sendable {
	var responses: [(Int, String)]
	var requests: [URLRequest] = []

	init(_ responses: [(Int, String)]) {
		self.responses = responses
	}

	func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
		requests.append(request)
		guard !responses.isEmpty else {
			throw URLError(.notConnectedToInternet)
		}
		let (status, body) = responses.removeFirst()
		return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
	}
}

final class APITests: XCTestCase {
	let account = Account(server: "https://cloud.example.com/", loginName: "ädmin", appPassword: "secret")

	func ocs(_ data: String) -> String {
		#"{"ocs":{"meta":{"status":"ok","statuscode":200,"message":"OK"},"data":\#(data)}}"#
	}

	func testRequestsCarryOcsHeadersAndBasicAuth() async throws {
		let http = StubHTTP([(200, ocs(#"{"revision":5,"items":[],"folders":[],"attachments":[],"tombstones":[]}"#))])
		let api = VPassAPI(transport: OCSTransport(account: account, client: http))
		let sync = try await api.sync(since: 4)
		XCTAssertEqual(sync.revision, 5)
		let request = try XCTUnwrap(http.requests.first)
		XCTAssertEqual(request.url?.absoluteString, "https://cloud.example.com/ocs/v2.php/apps/vpass/api/v1/sync?since=4")
		XCTAssertEqual(request.value(forHTTPHeaderField: "OCS-APIRequest"), "true")
		XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Basic \(Data("ädmin:secret".utf8).base64EncodedString())")
	}

	func testMissingVaultIsNil() async throws {
		let http = StubHTTP([(404, ocs(#"{"message":"No vault"}"#))])
		let vault = try await VPassAPI(transport: OCSTransport(account: account, client: http)).getVault()
		XCTAssertNil(vault)
	}

	func testConflictCarriesTheServerCopy() async throws {
		let current = #"{"id":"i","wrappedKey":"k","data":"d","revision":9,"createdAt":1,"updatedAt":2,"deletedAt":null}"#
		let http = StubHTTP([(409, ocs(#"{"message":"Conflict","current":\#(current)}"#))])
		let api = VPassAPI(transport: OCSTransport(account: account, client: http))
		do {
			_ = try await api.updateItem(id: "i", UpdatePayload(wrappedKey: "k", data: "d", baseRevision: 1))
			XCTFail("expected a conflict")
		} catch let error as ConflictError<ItemRecord> {
			XCTAssertEqual(error.current?.revision, 9)
		}
		let body = try JSONValue.parse(XCTUnwrap(http.requests.first?.httpBody))
		XCTAssertEqual(body["baseRevision"], 1)
	}

	func testErrorsUseTheOcsMessage() async throws {
		let http = StubHTTP([(400, ocs(#"{"message":"Bad envelope"}"#)), (500, "not json")])
		let api = VPassAPI(transport: OCSTransport(account: account, client: http))
		do {
			_ = try await api.trashItem(id: "x")
		} catch let error as ApiError {
			XCTAssertEqual(error.status, 400)
			XCTAssertEqual(error.message, "Bad envelope")
		}
		do {
			_ = try await api.trashItem(id: "x")
		} catch let error as ApiError {
			XCTAssertEqual(error.message, "HTTP 500")
		}
	}
}

final class LoginFlowTests: XCTestCase {
	func testNormaliseServer() throws {
		XCTAssertEqual(try LoginFlow.normaliseServer("cloud.example.com"), "https://cloud.example.com")
		XCTAssertEqual(try LoginFlow.normaliseServer(" https://Cloud.Example.com/index.php/apps/files?dir=/ "), "https://cloud.example.com")
		XCTAssertEqual(try LoginFlow.normaliseServer("https://example.com/nextcloud/apps/vpass/"), "https://example.com/nextcloud")
		XCTAssertEqual(try LoginFlow.normaliseServer("https://example.com:443/"), "https://example.com")
		XCTAssertEqual(try LoginFlow.normaliseServer("http://localhost:8080"), "http://localhost:8080")
		XCTAssertFalse(LoginFlow.isAllowed(server: "http://cloud.example.com"))
		XCTAssertTrue(LoginFlow.isAllowed(server: "http://localhost:8080"))
	}

	func testFlow() async throws {
		let http = StubHTTP([
			(200, #"{"poll":{"token":"tok+en","endpoint":"https://cloud.example.com/login/v2/poll"},"login":"https://cloud.example.com/login/v2/flow/abc"}"#),
			(404, "[]"),
			(200, #"{"server":"https://cloud.example.com/","loginName":"alice","appPassword":"app-pw"}"#),
		])
		let flow = LoginFlow(client: http, userAgent: "V-Pass test")
		let session = try await flow.start(serverInput: "cloud.example.com")
		XCTAssertEqual(session.loginURL.absoluteString, "https://cloud.example.com/login/v2/flow/abc")
		XCTAssertEqual(http.requests[0].value(forHTTPHeaderField: "User-Agent"), "V-Pass test")
		let pending = try await flow.poll(session)
		XCTAssertNil(pending)
		let account = try await flow.poll(session)
		XCTAssertEqual(account, Account(server: "https://cloud.example.com", loginName: "alice", appPassword: "app-pw"))
		XCTAssertEqual(String(data: http.requests[1].httpBody!, encoding: .utf8), "token=tok%2Ben")
		// Offline polls just keep waiting.
		let offline = try await flow.poll(session)
		XCTAssertNil(offline)
		do {
			_ = try await flow.poll(session, now: session.expires.addingTimeInterval(1))
			XCTFail("expected expiry")
		} catch is LoginFlowError {}
	}

	func testRefusesPlainHttp() async {
		do {
			_ = try await LoginFlow(client: StubHTTP([])).start(serverInput: "http://cloud.example.com")
			XCTFail("expected a refusal")
		} catch {
			XCTAssertTrue(error.localizedDescription.contains("https"))
		}
	}
}

final class ToolTests: XCTestCase {
	func testPasswordGenerator() throws {
		var opts = PasswordOptions()
		opts.length = 32
		let password = try generatePassword(opts)
		XCTAssertEqual(password.count, 32)
		XCTAssertTrue(password.contains { $0.isLowercase } && password.contains { $0.isUppercase } && password.contains { $0.isNumber })
		opts.lowercase = false
		opts.uppercase = false
		opts.symbols = false
		opts.length = 2
		XCTAssertEqual(try generatePassword(opts).count, 4)
		opts.digits = false
		XCTAssertThrowsError(try generatePassword(opts))
		var ambiguous = PasswordOptions()
		ambiguous.avoidAmbiguous = true
		ambiguous.length = 128
		XCTAssertFalse(try generatePassword(ambiguous).contains { "Il1O0o".contains($0) })
	}

	func testPassphrase() {
		var opts = PassphraseOptions()
		opts.words = 6
		opts.separator = "."
		let phrase = generatePassphrase(opts)
		let words = phrase.split(separator: ".")
		XCTAssertEqual(words.count, 6)
		XCTAssertTrue(words.allSatisfy { $0.first?.isUppercase == true })
		XCTAssertEqual(words.filter { $0.last?.isNumber == true }.count, 1)
		XCTAssertEqual(passphraseEntropyBits(PassphraseOptions()), 70)
	}

	func testTotpRejectsJunk() {
		for junk in ["", "otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP", "otpauth://totp/x", "otpauth://totp/x?secret=JBSW&digits=9", "!!!", "AB"] {
			XCTAssertThrowsError(try parseTotp(junk), junk)
		}
		XCTAssertEqual(formatTotpCode("123456"), "123 456")
		XCTAssertEqual(formatTotpCode("12345678"), "1234 5678")
	}

	func testFirstTotpSkipsOtherQRCodes() {
		let uri = "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example"
		XCTAssertEqual(firstTotp(in: ["https://example.com/app", "otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP", uri]), uri)
		XCTAssertNil(firstTotp(in: ["https://example.com/app"]))
		XCTAssertNil(firstTotp(in: []))
	}

	func testCollectsCodesFromSeveralScans() throws {
		// Two Google Authenticator codes of a three-code export (batch 99), as core's test helper builds them.
		func link(_ payload: Bytes) -> String {
			"otpauth-migration://offline?data=" + Data(payload).base64EncodedString().addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
		}
		func account(_ secret: String, _ name: String, _ issuer: String, type: UInt8 = 2) throws -> Bytes {
			let key = try base32Decode(secret)
			var fields: Bytes = [0x0A, UInt8(key.count)]
			fields += key
			fields += [0x12, UInt8(name.utf8.count)]
			fields += Bytes(name.utf8)
			fields += [0x1A, UInt8(issuer.utf8.count)]
			fields += Bytes(issuer.utf8)
			fields += [0x20, 1, 0x28, 1, 0x30, type]
			return [0x0A, UInt8(fields.count)] + fields
		}
		let batch: (UInt8) -> Bytes = { index in [0x10, 1, 0x18, 3, 0x20, index, 0x28, 99] }
		let first = link(try account("JBSWY3DPEHPK3PXP", "a", "A") + account("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "b", "B") + batch(0))
		let third = link(try account("MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U", "c", "C", type: 1) + batch(2))

		var collected = AuthenticatorImport()
		XCTAssertNil(collected.progress)
		XCTAssertEqual(try collected.add(first), AuthenticatorAddResult(added: 2, skipped: 0, repeated: false))
		XCTAssertEqual(collected.progress?.scanned, 1)
		XCTAssertEqual(collected.progress?.total, 3)
		XCTAssertEqual(try collected.add(" \(first)\n"), AuthenticatorAddResult(added: 0, skipped: 0, repeated: true))
		XCTAssertEqual(try collected.add("otpauth://totp/Other:label?secret=JBSWY3DPEHPK3PXP"), AuthenticatorAddResult(added: 0, skipped: 0, repeated: false))
		XCTAssertEqual(try collected.add(third), AuthenticatorAddResult(added: 0, skipped: 1, repeated: false))
		XCTAssertEqual(collected.progress?.scanned, 2)
		XCTAssertEqual(collected.entries.map(\.issuer), ["A", "B"])
		XCTAssertEqual(collected.skipped.map(\.issuer), ["C"])
		XCTAssertThrowsError(try collected.add("not a code"))
		XCTAssertTrue(isGoogleAuthenticatorExport(first))
		XCTAssertNil(firstTotp(in: [first]))
	}

	func testNewLoginForAnImportedCode() {
		let entry = AuthenticatorEntry(totp: "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP", issuer: "", account: "alice@example.com")
		let item = newLoginForAuthenticatorEntry(entry)
		XCTAssertEqual(item.type, .login)
		XCTAssertEqual(item.title, "alice@example.com")
		XCTAssertEqual(item.username, "alice@example.com")
		XCTAssertEqual(item.totp, entry.totp)
		XCTAssertEqual(newLoginForAuthenticatorEntry(AuthenticatorEntry(totp: entry.totp, issuer: "", account: "")).title, "One-time code")
	}

	func testMatchLoginsOrder() throws {
		func login(_ title: String, _ urls: [String]) throws -> Item {
			var item = Item.new(.login)
			item.title = title
			item.urls = urls
			return item
		}
		let items = [
			try login("b-domain", ["https://accounts.example.com"]),
			try login("a-origin", ["https://login.example.com"]),
			try login("unrelated", ["https://other.test"]),
			try login("c-host", ["https://www.login.example.com"]),
			Item.new(.note),
		]
		let matches = matchLogins(items, pageUrl: "https://login.example.com/x") { $0 }
		XCTAssertEqual(matches.map(\.entry.title), ["a-origin", "c-host", "b-domain"])
	}
}

#if canImport(CoreImage)
/// Apple platforms only (CI's macOS job): reading a QR code from a picture, as the app's scanner does with a screenshot.
final class QRImageTests: XCTestCase {
	func testReadsAuthenticatorQRCodeFromAnImage() throws {
		let uri = "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example"
		let generator = try XCTUnwrap(CIFilter(name: "CIQRCodeGenerator"))
		generator.setValue(Data(uri.utf8), forKey: "inputMessage")
		generator.setValue("M", forKey: "inputCorrectionLevel")
		let code = try XCTUnwrap(generator.outputImage).transformed(by: CGAffineTransform(scaleX: 8, y: 8))
		// A white margin around it, like a screenshot of a web page.
		let page = CIImage(color: CIColor(red: 1, green: 1, blue: 1)).cropped(to: code.extent.insetBy(dx: -80, dy: -80))
		let sRGB = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB))
		let png = try XCTUnwrap(CIContext().pngRepresentation(of: code.composited(over: page), format: .RGBA8, colorSpace: sRGB, options: [:]))

		XCTAssertEqual(qrPayloads(inImageData: png), [uri])
		XCTAssertEqual(firstTotp(in: qrPayloads(inImageData: png)), uri)
		XCTAssertEqual(qrPayloads(inImageData: Data("not an image".utf8)), [])
	}

	func testReadsGoogleAuthenticatorExportFromAnImage() throws {
		let link = "otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8SGEV4YW1wbGU6YWxpY2VAZ29vZ2xlLmNvbRoHRXhhbXBsZTAC"
		let generator = try XCTUnwrap(CIFilter(name: "CIQRCodeGenerator"))
		generator.setValue(Data(link.utf8), forKey: "inputMessage")
		let code = try XCTUnwrap(generator.outputImage).transformed(by: CGAffineTransform(scaleX: 8, y: 8))
		let page = CIImage(color: CIColor(red: 1, green: 1, blue: 1)).cropped(to: code.extent.insetBy(dx: -80, dy: -80))
		let sRGB = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB))
		let png = try XCTUnwrap(CIContext().pngRepresentation(of: code.composited(over: page), format: .RGBA8, colorSpace: sRGB, options: [:]))

		var collected = AuthenticatorImport()
		for payload in qrPayloads(inImageData: png) {
			try collected.add(payload)
		}
		XCTAssertEqual(collected.entries.map(\.account), ["alice@google.com"])
	}
}
#endif
