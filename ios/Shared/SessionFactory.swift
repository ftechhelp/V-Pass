import Foundation
import VPassKit

/// Builds the pieces the app and the extension share, real or (for UI tests) stubbed.
struct Services {
	let accounts: AccountStoring
	let biometrics: BiometricKeyStoring
	let makeAPI: (Account) async throws -> VPassAPI
	let store: VaultStore

	static func live() -> Services {
		Services(
			accounts: KeychainAccountStore(),
			biometrics: KeychainBiometricKeyStore(),
			makeAPI: { VPassAPI(transport: OCSTransport(account: $0)) },
			store: FileVaultStore(directory: AppGroup.directory)
		)
	}

	/// `-UITestStub`: the demo vault on an in-memory server; nothing is persisted.
	static func uiTest() -> Services {
		let server = DemoServerHolder()
		return Services(
			accounts: MemoryAccountStore(DemoVault.account),
			biometrics: NoBiometrics(),
			makeAPI: { _ in VPassAPI(transport: try await server.get()) },
			store: MemoryVaultStore()
		)
	}

	/// One per process, so the UI-test demo server keeps its state.
	static let current: Services = AppGroup.isUITest ? uiTest() : live()

	func session(for account: Account) async throws -> VaultSession {
		VaultSession(api: try await makeAPI(account), store: store)
	}
}

private actor DemoServerHolder {
	private var server: InMemoryServer?

	func get() async throws -> InMemoryServer {
		if let server {
			return server
		}
		let made = try await DemoVault.makeServer()
		server = made
		return made
	}
}
