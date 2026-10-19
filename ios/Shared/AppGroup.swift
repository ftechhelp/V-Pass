import Foundation
import VPassKit

/// Where the app and its AutoFill extension meet: the App Group container (the
/// encrypted vault cache), its user defaults (settings) and the shared Keychain
/// group (account, Face ID key). The identifiers come from Info.plist, which
/// project.yml fills from VPASS_BUNDLE_ID.
enum AppGroup {
	static var identifier: String? {
		Bundle.main.object(forInfoDictionaryKey: "VPassAppGroup") as? String
	}

	/// nil in builds without a team (unsigned simulator builds); the Keychain then
	/// uses the app's own default group.
	static var keychainGroup: String? {
		guard let group = Bundle.main.object(forInfoDictionaryKey: "VPassKeychainGroup") as? String,
			!group.isEmpty, !group.hasPrefix(".") else {
			return nil
		}
		return group
	}

	/// The App Group container, or the app's own Application Support folder when the
	/// entitlement is missing (unsigned simulator builds).
	static var directory: URL {
		if let identifier, let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier) {
			return container.appendingPathComponent("Library/Application Support/V-Pass", isDirectory: true)
		}
		return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
			.appendingPathComponent("V-Pass", isDirectory: true)
	}

	static var defaults: UserDefaults {
		identifier.flatMap { UserDefaults(suiteName: $0) } ?? .standard
	}

	/// The UI tests launch the app with `-UITestStub`: an in-memory demo server, no Keychain, no network.
	static var isUITest: Bool {
		ProcessInfo.processInfo.arguments.contains("-UITestStub")
	}
}

enum SettingsStore {
	private static let key = "settings"

	static func load() -> AppSettings {
		AppSettings.decode(AppGroup.defaults.data(forKey: key))
	}

	static func save(_ settings: AppSettings) {
		AppGroup.defaults.set(settings.encoded(), forKey: key)
	}
}
