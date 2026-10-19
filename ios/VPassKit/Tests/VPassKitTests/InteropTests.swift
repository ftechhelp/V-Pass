import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import VPassKit

/// The Swift client against a real V-Pass server, with data written by the
/// TypeScript core. Driven by `make test-ios-interop` (e2e/ios/interop.test.ts),
/// which seeds a vault, runs this test in Docker and then checks with core
/// everything written here. Skipped unless VPASS_INTEROP points at the seed file.
final class InteropTests: XCTestCase {
	func testAgainstDevServer() async throws {
		guard let seedPath = ProcessInfo.processInfo.environment["VPASS_INTEROP"] else {
			throw XCTSkip("Run through `make test-ios-interop`")
		}
		let seed = try JSONValue.parse(Data(contentsOf: URL(fileURLWithPath: seedPath)))
		let server = try XCTUnwrap(seed["server"]?.stringValue)
		var output: [String: JSONValue] = [:]

		// Login Flow v2 starts against the real server and waits for the user.
		let flow = LoginFlow(userAgent: "V-Pass interop test")
		let started = try await flow.start(serverInput: server)
		XCTAssertTrue(started.loginURL.absoluteString.contains("/login/v2/flow"))
		let pending = try await flow.poll(started)
		XCTAssertNil(pending)

		let account = Account(server: server, loginName: try XCTUnwrap(seed["user"]?.stringValue), appPassword: try XCTUnwrap(seed["password"]?.stringValue))
		let api = VPassAPI(transport: OCSTransport(account: account))
		let meta = try await api.getVault()
		let vault = try XCTUnwrap(meta)
		let vaultKey = try unlockWithPassword(try XCTUnwrap(seed["master"]?.stringValue), kdf: vault.kdf, wrappedVaultKey: vault.wrappedVaultKey)

		var cache = VaultCache()
		cache.applySync(try await api.sync(since: cache.revision))
		XCTAssertEqual(cache.revision, vault.revision)

		// Everything core wrote decrypts to the same JSON, unknown fields included.
		for expected in try XCTUnwrap(seed["items"]?.arrayValue) {
			let id = try XCTUnwrap(expected["id"]?.stringValue)
			let decrypted = try decryptItem(vaultKey: vaultKey, record: XCTUnwrap(cache.items[id]))
			XCTAssertEqual(decrypted.item.json, expected["parsed"], id)
		}
		let folderId = try XCTUnwrap(seed["folder"]?["id"]?.stringValue)
		XCTAssertEqual(try decryptFolder(vaultKey: vaultKey, record: XCTUnwrap(cache.folders[folderId])).folder.name, seed["folder"]?["name"]?.stringValue)

		// A new item made here.
		var created = Item.new(.login)
		created.title = "Made on iPhone"
		created.username = "swift@example.com"
		created.password = "swïft-🔑"
		created.urls = ["https://swift.example.com"]
		created.folderId = folderId
		created.customFields = [CustomField(label: "Hint", kind: .hidden, value: "h")]
		let createdId = uuid()
		let createdEnc = try encryptItem(vaultKey: vaultKey, id: createdId, item: created)
		let createdRecord = try await api.createItem(createdEnc.object)
		cache.putItem(createdRecord)
		XCTAssertEqual(cache.revision, createdRecord.revision)
		output["createdId"] = .string(createdId)

		// Edit core's login: new password, unknown fields untouched.
		let editId = try XCTUnwrap(seed["editId"]?.stringValue)
		let original = try decryptItem(vaultKey: vaultKey, record: XCTUnwrap(cache.items[editId]))
		var next = original.item
		next.password = "new-from-swift"
		next.notes = "edited on iPhone"
		let edited = try updateItem(previous: original.item, next: next)
		let editEnc = try encryptItem(vaultKey: vaultKey, id: editId, item: edited, itemKey: original.key)
		let editRecord = try await api.updateItem(id: editId, UpdatePayload(wrappedKey: editEnc.object.wrappedKey, data: editEnc.object.data, baseRevision: original.revision))
		cache.putItem(editRecord)

		// A second edit from the stale revision is refused with the server's copy.
		do {
			_ = try await api.updateItem(id: editId, UpdatePayload(wrappedKey: editEnc.object.wrappedKey, data: editEnc.object.data, baseRevision: original.revision))
			XCTFail("expected a conflict")
		} catch let conflict as ConflictError<ItemRecord> {
			XCTAssertEqual(conflict.current?.revision, editRecord.revision)
			XCTAssertEqual(try decryptItem(vaultKey: vaultKey, record: XCTUnwrap(conflict.current)).item.password, "new-from-swift")
		}

		// Trash and restore.
		let trashed = try await api.trashItem(id: createdId)
		XCTAssertNotNil(trashed.deletedAt)
		let restored = try await api.restoreItem(id: createdId)
		XCTAssertNil(restored.deletedAt)

		// A passkey made here, saved into a new login (as the AutoFill extension does).
		let createChallenge = randomBytes(32)
		let createClientData = utf8Encode(#"{"type":"webauthn.create","challenge":"\#(b64urlEncode(createChallenge))","origin":"https://webauthn.io","crossOrigin":false}"#)
		let newPasskey = try createPasskey(rpId: "webauthn.io", rpName: "WebAuthn.io", userHandle: utf8Encode("swift-user"), userName: "swifty", algorithm: es256)
		var passkeyLogin = Item.new(.login)
		passkeyLogin.title = "webauthn.io"
		passkeyLogin.username = "swifty"
		passkeyLogin.urls = ["https://webauthn.io"]
		passkeyLogin.passkeys = [newPasskey.passkey]
		let passkeyItemId = uuid()
		let passkeyRecord = try await api.createItem(try encryptItem(vaultKey: vaultKey, id: passkeyItemId, item: passkeyLogin).object)
		cache.putItem(passkeyRecord)
		output["passkeyItemId"] = .string(passkeyItemId)
		output["registration"] = [
			"id": .string(b64urlEncode(newPasskey.credentialId)),
			"challenge": .string(b64urlEncode(createChallenge)),
			"clientDataJSON": .string(b64urlEncode(createClientData)),
			"attestationObject": .string(b64urlEncode(newPasskey.attestationObject)),
		]

		// Sign in with the passkey core made.
		let tsPasskey = try XCTUnwrap(seed["passkey"])
		let holder = try decryptItem(vaultKey: vaultKey, record: XCTUnwrap(cache.items[try XCTUnwrap(tsPasskey["itemId"]?.stringValue)]))
		let stored = try XCTUnwrap(holder.item.passkeys.first)
		let getChallenge = randomBytes(32)
		let getClientData = utf8Encode(#"{"type":"webauthn.get","challenge":"\#(b64urlEncode(getChallenge))","origin":"https://webauthn.io","crossOrigin":false}"#)
		let assertion = try getAssertion(passkey: stored, rpId: "webauthn.io", clientDataHash: sha256(getClientData), allowCredentials: [stored.credentialId])
		output["assertion"] = [
			"id": .string(b64urlEncode(assertion.credentialId)),
			"challenge": .string(b64urlEncode(getChallenge)),
			"clientDataJSON": .string(b64urlEncode(getClientData)),
			"authenticatorData": .string(b64urlEncode(assertion.authenticatorData)),
			"signature": .string(b64urlEncode(assertion.signature)),
			"userHandle": .string(b64urlEncode(assertion.userHandle)),
		]

		// A fresh sync from our revision brings nothing we have not seen, except the
		// trash/restore round trip (their revisions came after our own writes).
		let latest = try await api.sync(since: cache.revision)
		cache.applySync(latest)
		XCTAssertEqual(cache.items[createdId]?.deletedAt, nil)

		let outputURL = URL(fileURLWithPath: seedPath).deletingLastPathComponent().appendingPathComponent("swift-output.json")
		try JSONValue.object(output).serializedData().write(to: outputURL)
	}
}
