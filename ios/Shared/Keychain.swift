import Foundation
import LocalAuthentication
import Security
import VPassKit

enum KeychainError: Error, LocalizedError {
	case status(OSStatus)
	case canceled

	var errorDescription: String? {
		switch self {
		case .canceled: "Cancelled"
		case let .status(status): (SecCopyErrorMessageString(status, nil) as String?) ?? "Keychain error \(status)"
		}
	}
}

/// Generic-password items in the shared Keychain group. Never synced to iCloud
/// and never in backups (`…ThisDeviceOnly`).
struct Keychain {
	let service: String
	var accessGroup: String? = AppGroup.keychainGroup

	private func query(_ account: String) -> [String: Any] {
		var query: [String: Any] = [
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: service,
			kSecAttrAccount as String: account,
		]
		if let accessGroup {
			query[kSecAttrAccessGroup as String] = accessGroup
		}
		return query
	}

	func set(_ data: Data, account: String, accessControl: SecAccessControl? = nil) throws {
		delete(account)
		var item = query(account)
		item[kSecValueData as String] = data
		if let accessControl {
			item[kSecAttrAccessControl as String] = accessControl
		} else {
			item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
		}
		let status = SecItemAdd(item as CFDictionary, nil)
		guard status == errSecSuccess else {
			throw KeychainError.status(status)
		}
	}

	/// Blocks while iOS asks for Face ID when the item needs it; call it off the main thread.
	func get(_ account: String, context: LAContext? = nil) throws -> Data? {
		var search = query(account)
		search[kSecReturnData as String] = true
		search[kSecMatchLimit as String] = kSecMatchLimitOne
		if let context {
			search[kSecUseAuthenticationContext as String] = context
		}
		var result: CFTypeRef?
		let status = SecItemCopyMatching(search as CFDictionary, &result)
		switch status {
		case errSecSuccess:
			return result as? Data
		case errSecItemNotFound:
			return nil
		case errSecUserCanceled, errSecAuthFailed:
			throw KeychainError.canceled
		default:
			throw KeychainError.status(status)
		}
	}

	@discardableResult
	func delete(_ account: String) -> Bool {
		SecItemDelete(query(account) as CFDictionary) == errSecSuccess
	}
}

/// The Nextcloud account (server, login name, app password).
protocol AccountStoring: Sendable {
	func load() -> Account?
	func save(_ account: Account) throws
	func delete()
}

struct KeychainAccountStore: AccountStoring {
	private let keychain = Keychain(service: "V-Pass account")

	func load() -> Account? {
		guard let data = try? keychain.get("default") else {
			return nil
		}
		return try? JSONDecoder().decode(Account.self, from: data)
	}

	func save(_ account: Account) throws {
		try keychain.set(JSONEncoder().encode(account), account: "default")
	}

	func delete() {
		keychain.delete("default")
	}
}

/// The UI-test stand-in: always connected to the demo server.
final class MemoryAccountStore: AccountStoring, @unchecked Sendable {
	private var account: Account?

	init(_ account: Account?) {
		self.account = account
	}

	func load() -> Account? { account }
	func save(_ account: Account) throws { self.account = account }
	func delete() { account = nil }
}

/// The vault key behind Face ID / Touch ID, so the app and AutoFill can unlock
/// without the master password. The item is removed by iOS when the enrolled
/// faces or fingers change (`biometryCurrentSet`), and it needs a device passcode.
protocol BiometricKeyStoring: Sendable {
	var isAvailable: Bool { get }
	var biometryName: String { get }
	func save(_ key: Bytes) throws
	/// Prompts for Face ID. nil when no key is saved (or iOS dropped it).
	func load(reason: String) async throws -> Bytes?
	func remove()
}

struct KeychainBiometricKeyStore: BiometricKeyStoring {
	private let keychain = Keychain(service: "V-Pass vault key")

	var isAvailable: Bool {
		LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
	}

	var biometryName: String {
		let context = LAContext()
		_ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
		switch context.biometryType {
		case .touchID: return "Touch ID"
		case .opticID: return "Optic ID"
		default: return "Face ID"
		}
	}

	func save(_ key: Bytes) throws {
		var error: Unmanaged<CFError>?
		guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error) else {
			throw error?.takeRetainedValue() ?? KeychainError.status(errSecParam)
		}
		try keychain.set(Data(key), account: "vaultKey", accessControl: access)
	}

	func load(reason: String) async throws -> Bytes? {
		let keychain = keychain
		return try await Task.detached {
			let context = LAContext()
			context.localizedReason = reason
			return try keychain.get("vaultKey", context: context).map { Bytes($0) }
		}.value
	}

	func remove() {
		keychain.delete("vaultKey")
	}
}

/// The UI-test stand-in: no biometrics.
struct NoBiometrics: BiometricKeyStoring {
	var isAvailable: Bool { false }
	var biometryName: String { "Face ID" }
	func save(_ key: Bytes) throws {}
	func load(reason: String) async throws -> Bytes? { nil }
	func remove() {}
}
