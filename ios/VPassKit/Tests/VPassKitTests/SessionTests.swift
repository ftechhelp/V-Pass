import Foundation
import XCTest
@testable import VPassKit

final class SessionTests: XCTestCase {
	static let password = "session master"
	static let vault: NewVault = try! createVaultKeys(masterPassword: password, kdf: newKdfParams(opsLimit: 2, memLimit: 32 * 1024 * 1024))

	func makeServer() -> InMemoryServer {
		InMemoryServer(meta: VaultMeta(kdf: Self.vault.keyset.kdf, wrappedVaultKey: Self.vault.keyset.wrappedVaultKey, recoveryWrappedVaultKey: Self.vault.keyset.recoveryWrappedVaultKey, revision: 0, createdAt: 1000, updatedAt: 1000))
	}

	func makeSession(_ server: InMemoryServer, store: VaultStore = MemoryVaultStore()) -> VaultSession {
		VaultSession(api: VPassAPI(transport: server), store: store)
	}

	func login(_ title: String, url: String, password: String = "pw") -> Item {
		var item = Item.new(.login)
		item.title = title
		item.username = "\(title.lowercased())@example.com"
		item.password = password
		item.urls = [url]
		return item
	}

	func testUnlockSyncCreateAndOfflineUnlock() async throws {
		let server = makeServer()
		let store = MemoryVaultStore()
		let session = makeSession(server, store: store)
		try await session.sync()
		let key = try await session.unlock(password: Self.password)
		XCTAssertEqual(key.bytes, Self.vault.vaultKey)
		let created = try await session.createItem(login("GitHub", url: "https://github.com"))
		let revision = await session.revision
		XCTAssertEqual(revision, 1)
		let snapshot = try await session.snapshot()
		XCTAssertEqual(snapshot.activeItems.map(\.id), [created.id])

		// A new session (the AutoFill extension, or the next launch) unlocks offline from the stored copy.
		server.offline = true
		let again = makeSession(server, store: store)
		try await again.unlock(password: Self.password)
		let offline = try await again.snapshot()
		XCTAssertEqual(offline.activeItems.first?.item.title, "GitHub")
		await again.lock()
		do {
			_ = try await again.snapshot()
			XCTFail("expected locked")
		} catch is LockedError {}
	}

	func testWrongPasswordAndNoVault() async throws {
		let session = makeSession(makeServer())
		do {
			try await session.unlock(password: "nope")
			XCTFail("expected a wrong password")
		} catch is WrongPasswordError {}
		let empty = makeSession(InMemoryServer(meta: nil))
		do {
			try await empty.unlock(password: "x")
			XCTFail("expected no vault")
		} catch is NoVaultError {}
	}

	func testBiometricKeyIsCheckedAgainstTheVault() async throws {
		let server = makeServer()
		let session = makeSession(server)
		try await session.unlock(password: Self.password)
		_ = try await session.createItem(login("A", url: "https://a.test"))
		await session.lock()
		do {
			try await session.unlock(vaultKey: generateKey())
			XCTFail("expected a stale key")
		} catch is StaleVaultKeyError {}
		try await session.unlock(vaultKey: Self.vault.vaultKey)
		let unlocked = await session.isUnlocked
		XCTAssertTrue(unlocked)
	}

	func testEditConflictKeepsTheServerCopy() async throws {
		let server = makeServer()
		let session = makeSession(server)
		try await session.unlock(password: Self.password)
		let base = try await session.createItem(login("Bank", url: "https://bank.test", password: "one"))

		// Another device edits it first.
		var theirs = base.item
		theirs.password = "theirs"
		server.otherDeviceUpdates(base.id, data: try encryptItem(vaultKey: Self.vault.vaultKey, id: base.id, item: theirs, itemKey: base.key).object.data)

		var mine = base.item
		mine.password = "mine"
		do {
			_ = try await session.save(id: base.id, base: base, edited: mine)
			XCTFail("expected a conflict")
		} catch let conflict as EditConflictError {
			XCTAssertEqual(conflict.server.item.password, "theirs")
			// Saving again on top of the server copy works.
			let saved = try await session.save(id: base.id, base: conflict.server, edited: mine)
			XCTAssertEqual(saved.item.password, "mine")
			XCTAssertEqual(saved.item.passwordHistory.first?.password, "theirs")
		}
	}

	func testModifyItemRetriesOnceOnTheServerCopy() async throws {
		let server = makeServer()
		let session = makeSession(server)
		try await session.unlock(password: Self.password)
		let base = try await session.createItem(login("Site", url: "https://site.test"))
		var theirs = base.item
		theirs.notes = "changed elsewhere"
		server.otherDeviceUpdates(base.id, data: try encryptItem(vaultKey: Self.vault.vaultKey, id: base.id, item: theirs, itemKey: base.key).object.data)

		let passkey = try createPasskey(rpId: "site.test", userHandle: [1, 2, 3], userName: "me", algorithm: es256).passkey
		let updated = try await session.modifyItem(id: base.id) { item in
			itemWithPasskey(passkey, adding: item, rpName: "")
		}
		XCTAssertEqual(updated.item.notes, "changed elsewhere")
		XCTAssertEqual(updated.item.passkeys.map(\.credentialId), [passkey.credentialId])
	}

	func testTrashRestoreAndFolders() async throws {
		let server = makeServer()
		let session = makeSession(server)
		try await session.unlock(password: Self.password)
		let item = try await session.createItem(login("Old", url: "https://old.test"))
		try await session.trash(id: item.id)
		var snapshot = try await session.snapshot()
		XCTAssertTrue(snapshot.activeItems.isEmpty)
		XCTAssertEqual(snapshot.items.count, 1)
		try await session.restore(id: item.id)
		let folderId = try await session.createFolder(name: "Work")
		snapshot = try await session.snapshot()
		XCTAssertEqual(snapshot.activeItems.count, 1)
		XCTAssertEqual(snapshot.folderName(folderId), "Work")
		XCTAssertEqual(server.requests.filter { $0.hasPrefix("POST /items/") }.count, 2)
	}

	func testRecreatedVaultLocksAndClears() async throws {
		let server = makeServer()
		let session = makeSession(server)
		try await session.sync()
		try await session.unlock(password: Self.password)
		_ = try await session.createItem(login("A", url: "https://a.test"))
		server.meta!.createdAt = 2000
		server.items.removeAll()
		try await session.sync()
		let unlocked = await session.isUnlocked
		XCTAssertFalse(unlocked)
		let revision = await session.revision
		XCTAssertEqual(revision, server.revision)
	}

	func testFileStoreRoundTrip() throws {
		let dir = FileManager.default.temporaryDirectory.appendingPathComponent("vpass-\(uuid())")
		defer { try? FileManager.default.removeItem(at: dir) }
		let store = FileVaultStore(directory: dir)
		XCTAssertNil(try store.loadCache())
		var cache = VaultCache()
		cache.putItem(ItemRecord(id: "a", wrappedKey: "k", data: "d", revision: 1, createdAt: 0, updatedAt: 0, deletedAt: nil))
		try store.saveCache(cache)
		XCTAssertEqual(try store.loadCache(), cache)
		try store.saveMeta(nil)
		XCTAssertNil(try store.loadMeta())
		store.erase()
		XCTAssertNil(try store.loadCache())
	}
}

final class AutoFillCatalogTests: XCTestCase {
	func entry(_ item: Item, id: String = uuid(), deletedAt: Int? = nil) -> DecryptedItem {
		DecryptedItem(id: id, item: item, key: SecretKey(generateKey()), revision: 1, createdAt: 0, updatedAt: 0, deletedAt: deletedAt)
	}

	func login(_ title: String, _ urls: [String], password: String = "pw", totp: String = "") -> Item {
		var item = Item.new(.login)
		item.title = title
		item.username = "user"
		item.password = password
		item.urls = urls
		item.totp = totp
		return item
	}

	func testIdentities() throws {
		var withPasskey = login("Passkey only", ["https://webauthn.io"], password: "")
		let passkey = try createPasskey(rpId: "webauthn.io", userHandle: [9], userName: "pk-user", algorithm: es256).passkey
		withPasskey.passkeys = [passkey]
		let items = [
			entry(login("GitHub", ["https://github.com/login", "github.com", "androidapp://x"], totp: "JBSWY3DPEHPK3PXP"), id: "1"),
			entry(withPasskey, id: "2"),
			entry(login("Trashed", ["https://trash.test"]), id: "3", deletedAt: 5),
			entry(Item.new(.note), id: "4"),
			entry(login("Bad TOTP", ["https://bad.test"], totp: "!!!"), id: "5"),
		]
		let identities = credentialIdentities(for: items)
		XCTAssertEqual(identities.passwords.map(\.host), ["github.com", "bad.test"])
		XCTAssertEqual(identities.oneTimeCodes.map(\.host), ["github.com"])
		XCTAssertEqual(identities.oneTimeCodes.first?.label, "GitHub")
		XCTAssertEqual(identities.passkeys.count, 1)
		XCTAssertEqual(identities.passkeys.first?.rpId, "webauthn.io")
		XCTAssertEqual(identities.passkeys.first?.userName, "pk-user")
		XCTAssertEqual(identities.passkeys.first?.userHandle, [9])
		XCTAssertEqual(identities.passkeys.first?.recordIdentifier, "2")
	}

	func testRankingAcrossServiceIdentifiers() {
		let items = [
			entry(login("Domain", ["https://accounts.example.com"]), id: "d"),
			entry(login("Exact", ["https://login.example.com"]), id: "e"),
			entry(login("Other", ["https://other.test"]), id: "o"),
			entry(login("Trashed", ["https://login.example.com"]), id: "t", deletedAt: 1),
		]
		let ranked = rankLogins(items, serviceIdentifiers: ["login.example.com", "https://login.example.com/signin"])
		XCTAssertEqual(ranked.map(\.entry.id), ["e", "d"])
		XCTAssertEqual(ranked.first?.match.kind, .origin)
	}

	func testPasskeyLookupAndNewPasskeyTargets() throws {
		var item = login("WebAuthn", ["https://webauthn.io"])
		let first = try createPasskey(rpId: "webauthn.io", userHandle: [1], userName: "alice", algorithm: es256).passkey
		item.passkeys = [first]
		let items = [entry(item, id: "w"), entry(login("Blank", ["https://webauthn.io"]), id: "b")]
		XCTAssertEqual(passkeys(in: items, rpId: "webauthn.io").map(\.entry.id), ["w"])
		XCTAssertTrue(passkeys(in: items, rpId: "webauthn.io", allowCredentials: ["nope"]).isEmpty)
		XCTAssertTrue(passkeys(in: items, rpId: "other.io").isEmpty)
		XCTAssertEqual(loginsForNewPasskey(in: items, rpId: "webauthn.io", userName: "alice").map(\.id), ["b"])

		let second = try createPasskey(rpId: "webauthn.io", userHandle: [2], userName: "bob", algorithm: es256).passkey
		let fresh = itemWithPasskey(second, adding: nil, rpName: "WebAuthn.io")
		XCTAssertEqual(fresh.title, "WebAuthn.io")
		XCTAssertEqual(fresh.urls, ["https://webauthn.io"])
		XCTAssertEqual(fresh.username, "bob")
		XCTAssertEqual(itemWithPasskey(second, adding: item, rpName: "").passkeys.count, 2)
	}

	func testSettingsTolerateUnknownAndMissingKeys() {
		var settings = AppSettings()
		settings.autoLock = .oneHour
		settings.password.length = 30
		XCTAssertEqual(AppSettings.decode(settings.encoded()), settings)
		XCTAssertEqual(AppSettings.decode(Data(#"{"autoLock":60,"somethingNew":true}"#.utf8)).autoLock, .oneMinute)
		XCTAssertEqual(AppSettings.decode(Data("junk".utf8)), AppSettings())
		XCTAssertEqual(AppSettings.decode(nil).clipboardClear, .oneMinute)
	}
}

final class DemoVaultTests: XCTestCase {
	func testDemoVaultUnlocks() async throws {
		let server = try await DemoVault.makeServer()
		let session = VaultSession(api: VPassAPI(transport: server), store: MemoryVaultStore())
		try await session.sync()
		try await session.unlock(password: DemoVault.masterPassword)
		let snapshot = try await session.snapshot()
		XCTAssertEqual(Set(snapshot.activeItems.map { itemDisplayTitle($0.item) }), ["GitHub", "Bank", "Wi-Fi", "Visa", "Personal"])
		XCTAssertEqual(snapshot.folders.map(\.name), ["Work"])
	}
}
