import UIKit
import UniformTypeIdentifiers
import VPassKit

/// Copies stay on this device (no Universal Clipboard) and expire after the
/// clipboard-clear setting, which iOS enforces even when V-Pass is not running.
enum Clipboard {
	static func copy(_ text: String, clear: AppSettings.ClipboardClear) {
		var options: [UIPasteboard.OptionsKey: Any] = [.localOnly: true]
		if clear != .never {
			options[.expirationDate] = Date().addingTimeInterval(TimeInterval(clear.rawValue))
		}
		UIPasteboard.general.setItems([[UTType.plainText.identifier: text]], options: options)
	}
}
