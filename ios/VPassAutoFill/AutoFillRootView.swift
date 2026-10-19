import AuthenticationServices
import SwiftUI
import VPassKit

struct AutoFillRootView: View {
	@Environment(AutoFillModel.self) private var model

	var body: some View {
		NavigationStack {
			content
				.navigationBarTitleDisplayMode(.inline)
				.toolbar {
					ToolbarItem(placement: .cancellationAction) {
						Button("Cancel") { model.cancel() }
					}
				}
		}
	}

	@ViewBuilder
	private var content: some View {
		switch model.phase {
		case .starting:
			ProgressView()
		case .notConnected:
			message("Open V-Pass first", "Connect V-Pass to your Nextcloud in the app, then AutoFill can use your vault.", symbol: "server.rack")
		case .locked:
			ScrollView {
				UnlockForm(
					title: "Unlock V-Pass",
					subtitle: model.siteName.map { "to fill \($0)" },
					biometryName: model.biometryName,
					busy: model.busy,
					error: model.unlockError,
					onPassword: { password in Task { await model.unlock(password: password) } },
					onBiometrics: { Task { await model.unlockWithBiometrics() } }
				)
				.frame(maxWidth: .infinity)
			}
		case .choosing:
			CredentialList()
		case .savePasskey:
			SavePasskeyView()
		case .configured:
			VStack(spacing: 16) {
				message("V-Pass AutoFill is on", "Your logins now show up in the keyboard bar and in the Passwords sheet.", symbol: "checkmark.shield")
				Button("Done") { model.finishConfiguration() }
					.buttonStyle(.borderedProminent)
			}
		case let .failed(text):
			VStack(spacing: 16) {
				message("V-Pass can't do this", text, symbol: "exclamationmark.triangle")
				Button("Close") { model.cancel(.failed) }
					.buttonStyle(.borderedProminent)
			}
		}
	}

	private func message(_ title: String, _ text: String, symbol: String) -> some View {
		ContentUnavailableView(title, systemImage: symbol, description: Text(text))
	}
}

private struct CredentialList: View {
	@Environment(AutoFillModel.self) private var model

	var body: some View {
		@Bindable var model = model
		List {
			let passkeys = model.passkeyMatches
			if !passkeys.isEmpty {
				Section("Passkeys") {
					ForEach(passkeys, id: \.passkey.credentialId) { entry in
						Button {
							model.choose(entry)
						} label: {
							HStack {
								ItemIcon(item: entry.entry.item)
								VStack(alignment: .leading) {
									Text(entry.passkey.userName.isEmpty ? itemDisplayTitle(entry.entry.item) : entry.passkey.userName)
									Text(entry.passkey.rpId).font(.subheadline).foregroundStyle(.secondary)
								}
							}
						}
						.foregroundStyle(.primary)
					}
				}
			}
			let matches = model.matches
			if !matches.isEmpty {
				Section(model.siteName.map { "For \($0)" } ?? "Suggested") {
					ForEach(matches, id: \.id) { entry in row(entry) }
				}
			}
			Section(matches.isEmpty && passkeys.isEmpty ? "No match for \(model.siteName ?? "this site")" : "All logins") {
				ForEach(model.others, id: \.id) { entry in row(entry) }
			}
		}
		.searchable(text: $model.search, prompt: "Search")
		.navigationTitle(model.wantsCodes ? "One-time codes" : "V-Pass")
	}

	private func row(_ entry: DecryptedItem) -> some View {
		Button {
			model.choose(entry)
		} label: {
			HStack {
				ItemRow(item: entry.item)
				if model.wantsCodes, let params = try? parseTotp(entry.item.totp) {
					TimelineView(.periodic(from: .now, by: 1)) { context in
						Text(formatTotpCode(totpCode(params, now: context.date).code))
							.font(.system(.body, design: .monospaced))
							.foregroundStyle(.secondary)
					}
				}
			}
		}
		.foregroundStyle(.primary)
	}
}

private struct SavePasskeyView: View {
	@Environment(AutoFillModel.self) private var model

	var body: some View {
		if let registration = model.registration {
			List {
				Section {
					VStack(alignment: .leading, spacing: 6) {
						Label("Save a passkey for \(registration.rpId)", systemImage: "person.badge.key.fill")
							.font(.headline)
						if !registration.userName.isEmpty {
							Text(registration.userName).foregroundStyle(.secondary)
						}
						Text("It is stored in your V-Pass vault and works in the browser extension too.")
							.font(.footnote)
							.foregroundStyle(.secondary)
					}
					.padding(.vertical, 4)
				}
				if !registration.targets.isEmpty {
					Section("Add to an existing login") {
						ForEach(registration.targets, id: \.id) { entry in
							Button {
								Task { await model.savePasskey(into: entry) }
							} label: {
								ItemRow(item: entry.item)
							}
							.foregroundStyle(.primary)
						}
					}
				}
				Section {
					Button {
						Task { await model.savePasskey(into: nil) }
					} label: {
						Label("Save as a new login", systemImage: "plus")
					}
					.accessibilityIdentifier("save-new-passkey")
				}
			}
			.disabled(model.busy)
			.overlay {
				if model.busy { ProgressView() }
			}
			.navigationTitle("New passkey")
		}
	}
}
