import SwiftUI
import VPassKit

/// Master password (and Face ID) unlock, used by the app and the AutoFill sheet.
struct UnlockForm: View {
	var title = "V-Pass is locked"
	var subtitle: String?
	var biometryName: String?
	var busy = false
	var error: String?
	var onPassword: (String) -> Void
	var onBiometrics: (() -> Void)?
	var onRecoveryKey: (() -> Void)?

	@State private var password = ""
	@FocusState private var focused: Bool

	var body: some View {
		VStack(spacing: 20) {
			Image(systemName: "lock.shield.fill")
				.font(.system(size: 56))
				.foregroundStyle(Color.accentColor)
				.accessibilityHidden(true)
			VStack(spacing: 6) {
				Text(title)
					.font(.title2.bold())
				if let subtitle {
					Text(subtitle)
						.font(.subheadline)
						.foregroundStyle(.secondary)
						.multilineTextAlignment(.center)
				}
			}
			SecureField("Master password", text: $password)
				.textContentType(.password)
				.submitLabel(.go)
				.focused($focused)
				.onSubmit(submit)
				.padding(12)
				.background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
				.accessibilityIdentifier("master-password")
			if let error {
				Text(error)
					.font(.footnote)
					.foregroundStyle(.red)
					.multilineTextAlignment(.center)
					.accessibilityIdentifier("unlock-error")
			}
			Button(action: submit) {
				Group {
					if busy {
						ProgressView()
					} else {
						Text("Unlock")
					}
				}
				.frame(maxWidth: .infinity)
			}
			.buttonStyle(.borderedProminent)
			.controlSize(.large)
			.disabled(password.isEmpty || busy)
			.accessibilityIdentifier("unlock")
			if let biometryName, let onBiometrics {
				Button {
					onBiometrics()
				} label: {
					Label("Unlock with \(biometryName)", systemImage: biometryName == "Touch ID" ? "touchid" : "faceid")
				}
				.disabled(busy)
			}
			if let onRecoveryKey {
				Button("Use recovery key", action: onRecoveryKey)
					.font(.footnote)
					.disabled(busy)
			}
		}
		.padding(24)
		.frame(maxWidth: 420)
		.onAppear {
			if biometryName == nil {
				focused = true
			}
		}
	}

	private func submit() {
		guard !password.isEmpty, !busy else {
			return
		}
		let value = password
		password = ""
		onPassword(value)
	}
}
