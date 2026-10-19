import SwiftUI
import VPassKit

struct SettingsView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.dismiss) private var dismiss
	@State private var confirmDisconnect = false
	@State private var showGenerator = false

	var body: some View {
		@Bindable var model = model
		NavigationStack {
			Form {
				Section {
					if model.canUseBiometrics {
						Toggle("Unlock with \(model.services.biometrics.biometryName)", isOn: Binding(
							get: { model.settings.biometricUnlock },
							set: { enabled in Task { await model.setBiometricUnlock(enabled) } }
						))
					}
					Picker("Lock", selection: $model.settings.autoLock) {
						ForEach(AppSettings.AutoLock.allCases) { Text($0.label).tag($0) }
					}
					Picker("Clear copied items", selection: $model.settings.clipboardClear) {
						ForEach(AppSettings.ClipboardClear.allCases) { Text($0.label).tag($0) }
					}
				} header: {
					Text("Security")
				} footer: {
					Text("With \(model.services.biometrics.biometryName) on, the vault key is kept in this iPhone's Keychain, usable only after \(model.services.biometrics.biometryName) and never synced or backed up.")
				}

				Section {
					LabeledContent("AutoFill", value: model.autoFillEnabled ? "On" : "Off")
					Button("Open AutoFill settings") { model.openAutoFillSettings() }
					Toggle("Suggestions in the keyboard bar", isOn: $model.settings.keyboardSuggestions)
				} header: {
					Text("AutoFill")
				} footer: {
					Text("Turn on V-Pass in Settings → General → AutoFill & Passwords. Keyboard suggestions let iOS show matching logins directly; for that iOS keeps the websites and usernames (never passwords) on this device.")
				}

				Section("Tools") {
					Button("Password generator") { showGenerator = true }
				}

				Section {
					if let account = model.account {
						LabeledContent("Server", value: URL(string: account.server)?.host ?? account.server)
						LabeledContent("Account", value: account.loginName)
					}
					if let lastSync = model.lastSync {
						LabeledContent("Last sync", value: lastSync.formatted(date: .omitted, time: .shortened))
					}
					if let error = model.syncError {
						Text(error).font(.footnote).foregroundStyle(.red)
					}
					Button("Sync now") { Task { await model.sync() } }
					Button("Disconnect this iPhone", role: .destructive) { confirmDisconnect = true }
				} header: {
					Text("Nextcloud")
				} footer: {
					Text("Attachments, password health, import and export, and vault settings are in the V-Pass web app.")
				}

				Section {
					LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
				}
			}
			.navigationTitle("Settings")
			.navigationBarTitleDisplayMode(.inline)
			.toolbar {
				ToolbarItem(placement: .confirmationAction) {
					Button("Done") { dismiss() }
				}
			}
			.confirmationDialog("Disconnect this iPhone?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
				Button("Disconnect", role: .destructive) {
					dismiss()
					Task { await model.disconnect() }
				}
			} message: {
				Text("V-Pass revokes its app password and removes the vault copy, the saved key and the AutoFill suggestions from this iPhone. Your vault on Nextcloud is not touched.")
			}
			.sheet(isPresented: $showGenerator) {
				GeneratorView()
			}
			.task { await model.refreshAutoFillState() }
		}
	}
}
