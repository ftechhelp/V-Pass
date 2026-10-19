import Foundation

/// Per-device preferences, shared by the app and the AutoFill extension (App Group
/// user defaults). Conveniences only; nothing secret.
public struct AppSettings: Codable, Sendable, Equatable {
	public enum AutoLock: Int, Codable, Sendable, CaseIterable, Identifiable {
		case immediately = 0
		case oneMinute = 60
		case fiveMinutes = 300
		case fifteenMinutes = 900
		case oneHour = 3600

		public var id: Int { rawValue }

		public var label: String {
			switch self {
			case .immediately: "When leaving the app"
			case .oneMinute: "After 1 minute"
			case .fiveMinutes: "After 5 minutes"
			case .fifteenMinutes: "After 15 minutes"
			case .oneHour: "After 1 hour"
			}
		}
	}

	public enum ClipboardClear: Int, Codable, Sendable, CaseIterable, Identifiable {
		case never = 0
		case thirtySeconds = 30
		case oneMinute = 60
		case fiveMinutes = 300

		public var id: Int { rawValue }

		public var label: String {
			switch self {
			case .never: "Never"
			case .thirtySeconds: "After 30 seconds"
			case .oneMinute: "After 1 minute"
			case .fiveMinutes: "After 5 minutes"
			}
		}
	}

	public enum GeneratorMode: String, Codable, Sendable, CaseIterable {
		case password, passphrase
	}

	/// How long the app stays unlocked in the background.
	public var autoLock: AutoLock = .fiveMinutes
	public var clipboardClear: ClipboardClear = .oneMinute
	/// The vault key is kept in the Keychain behind Face ID / Touch ID.
	public var biometricUnlock = false
	/// Register sites and usernames with iOS so V-Pass shows up in the keyboard bar.
	public var keyboardSuggestions = true
	public var generatorMode: GeneratorMode = .password
	public var password = PasswordOptions()
	public var passphrase = PassphraseOptions()

	public init() {}

	public init(from decoder: Decoder) throws {
		// Tolerate settings written by an older or newer version: missing keys keep their defaults.
		let c = try decoder.container(keyedBy: CodingKeys.self)
		let d = AppSettings()
		autoLock = (try? c.decode(AutoLock.self, forKey: .autoLock)) ?? d.autoLock
		clipboardClear = (try? c.decode(ClipboardClear.self, forKey: .clipboardClear)) ?? d.clipboardClear
		biometricUnlock = (try? c.decode(Bool.self, forKey: .biometricUnlock)) ?? d.biometricUnlock
		keyboardSuggestions = (try? c.decode(Bool.self, forKey: .keyboardSuggestions)) ?? d.keyboardSuggestions
		generatorMode = (try? c.decode(GeneratorMode.self, forKey: .generatorMode)) ?? d.generatorMode
		password = (try? c.decode(PasswordOptions.self, forKey: .password)) ?? d.password
		passphrase = (try? c.decode(PassphraseOptions.self, forKey: .passphrase)) ?? d.passphrase
	}

	public static func decode(_ data: Data?) -> AppSettings {
		data.flatMap { try? JSONDecoder().decode(AppSettings.self, from: $0) } ?? AppSettings()
	}

	public func encoded() -> Data {
		(try? JSONEncoder().encode(self)) ?? Data()
	}
}
