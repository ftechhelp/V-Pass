import SwiftUI
import VPassKit

/// Password and passphrase generator. With `onUse` it fills the editor's password.
struct GeneratorView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.dismiss) private var dismiss
	var onUse: ((String) -> Void)?
	@State private var value = ""

	var body: some View {
		@Bindable var model = model
		NavigationStack {
			Form {
				Section {
					Text(value)
						.font(.system(.title3, design: .monospaced))
						.textSelection(.enabled)
						.frame(maxWidth: .infinity, alignment: .leading)
						.accessibilityIdentifier("generated")
					HStack {
						Button {
							regenerate()
						} label: {
							Label("Regenerate", systemImage: "arrow.clockwise")
						}
						Spacer()
						Button {
							model.copy(value, label: "Password")
						} label: {
							Label("Copy", systemImage: "doc.on.doc")
						}
					}
					.buttonStyle(.borderless)
				} footer: {
					Text("About \(entropy) bits of entropy")
				}
				Section {
					Picker("Type", selection: $model.settings.generatorMode) {
						Text("Password").tag(AppSettings.GeneratorMode.password)
						Text("Passphrase").tag(AppSettings.GeneratorMode.passphrase)
					}
					.pickerStyle(.segmented)
				}
				if model.settings.generatorMode == .password {
					Section("Password") {
						Stepper("Length: \(model.settings.password.length)", value: $model.settings.password.length, in: passwordLengthRange)
						Slider(value: Binding(
							get: { Double(model.settings.password.length) },
							set: { model.settings.password.length = Int($0) }
						), in: 8...64, step: 1)
						Toggle("Lowercase (a–z)", isOn: $model.settings.password.lowercase)
						Toggle("Uppercase (A–Z)", isOn: $model.settings.password.uppercase)
						Toggle("Digits (0–9)", isOn: $model.settings.password.digits)
						Toggle("Symbols (!@#…)", isOn: $model.settings.password.symbols)
						Toggle("Avoid look-alikes (Il1O0)", isOn: $model.settings.password.avoidAmbiguous)
					}
				} else {
					Section("Passphrase") {
						Stepper("Words: \(model.settings.passphrase.words)", value: $model.settings.passphrase.words, in: passphraseWordsRange)
						Picker("Separator", selection: $model.settings.passphrase.separator) {
							Text("-").tag("-")
							Text(".").tag(".")
							Text("_").tag("_")
							Text("Space").tag(" ")
						}
						Toggle("Capitalize", isOn: $model.settings.passphrase.capitalize)
						Toggle("Include a number", isOn: $model.settings.passphrase.includeNumber)
					}
				}
			}
			.navigationTitle("Generator")
			.navigationBarTitleDisplayMode(.inline)
			.toolbar {
				ToolbarItem(placement: .cancellationAction) {
					Button(onUse == nil ? "Done" : "Cancel") { dismiss() }
				}
				if let onUse {
					ToolbarItem(placement: .confirmationAction) {
						Button("Use") {
							onUse(value)
							dismiss()
						}
						.disabled(value.isEmpty)
						.accessibilityIdentifier("use-password")
					}
				}
			}
			.onAppear(perform: regenerate)
			.onChange(of: model.settings.password) { regenerate() }
			.onChange(of: model.settings.passphrase) { regenerate() }
			.onChange(of: model.settings.generatorMode) { regenerate() }
		}
	}

	private var entropy: Int {
		model.settings.generatorMode == .password
			? passwordEntropyBits(model.settings.password)
			: passphraseEntropyBits(model.settings.passphrase)
	}

	private func regenerate() {
		if model.settings.generatorMode == .password {
			value = (try? generatePassword(model.settings.password)) ?? ""
		} else {
			value = generatePassphrase(model.settings.passphrase)
		}
	}
}
