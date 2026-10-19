import Foundation

/// A small throwaway vault on an `InMemoryServer`, for the app's UI-test mode
/// (`-UITestStub`) and SwiftUI previews. Nothing here touches a real server.
public enum DemoVault {
	public static let masterPassword = "demo master password"
	public static let account = Account(server: "https://demo.invalid", loginName: "demo", appPassword: "demo")

	public static func makeServer() async throws -> InMemoryServer {
		let kdf = try newKdfParams(opsLimit: 2, memLimit: 32 * 1024 * 1024)
		let vault = try createVaultKeys(masterPassword: masterPassword, kdf: kdf)
		let server = InMemoryServer(meta: VaultMeta(
			kdf: kdf,
			wrappedVaultKey: vault.keyset.wrappedVaultKey,
			recoveryWrappedVaultKey: vault.keyset.recoveryWrappedVaultKey,
			revision: 0,
			createdAt: 1_700_000_000,
			updatedAt: 1_700_000_000
		))
		let api = VPassAPI(transport: server)

		let folderId = uuid()
		_ = try await api.createFolder(try encryptFolder(vaultKey: vault.vaultKey, id: folderId, folder: Folder(name: "Work")).object)

		var github = Item.new(.login)
		github.title = "GitHub"
		github.username = "octocat"
		github.password = "correct-horse-battery"
		github.urls = ["https://github.com"]
		github.totp = "otpauth://totp/GitHub:octocat?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"
		github.favorite = true
		github.folderId = folderId

		var bank = Item.new(.login)
		bank.title = "Bank"
		bank.username = "me@example.com"
		bank.password = "s3cret-bank"
		bank.urls = ["https://bank.example.com"]

		var note = Item.new(.note)
		note.title = "Wi-Fi"
		note.notes = "Network: Home\nPassword: hunter2"

		var card = Item.new(.card)
		card.title = "Visa"
		card.setText("cardholderName", "Demo Person")
		card.setText("number", "4111111111111111")
		card.setText("expMonth", "07")
		card.setText("expYear", "2031")
		card.setText("cvc", "123")

		var identity = Item.new(.identity)
		identity.title = "Personal"
		identity.setText("firstName", "Demo")
		identity.setText("lastName", "Person")
		identity.setText("email", "demo@example.com")

		for item in [github, bank, note, card, identity] {
			_ = try await api.createItem(try encryptItem(vaultKey: vault.vaultKey, id: uuid(), item: item).object)
		}
		return server
	}
}
