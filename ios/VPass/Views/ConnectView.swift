import SafariServices
import SwiftUI
import VPassKit

/// Connect to Nextcloud with Login Flow v2: the user signs in (with 2FA) on the
/// server's own page and grants access; V-Pass then gets an app password that
/// only this iPhone uses.
struct ConnectView: View {
	@Environment(AppModel.self) private var model
	@State private var server = ""
	@State private var flow: LoginFlowSession?
	@State private var error: String?
	@State private var starting = false

	var body: some View {
		NavigationStack {
			Form {
				Section {
					VStack(alignment: .leading, spacing: 8) {
						Label("Connect to Nextcloud", systemImage: "server.rack")
							.font(.title3.bold())
						Text("V-Pass keeps your vault on your Nextcloud server, encrypted before it leaves this iPhone. Sign in once; V-Pass gets its own app password.")
							.font(.subheadline)
							.foregroundStyle(.secondary)
					}
					.padding(.vertical, 4)
				}
				Section("Server") {
					TextField("cloud.example.com", text: $server)
						.textContentType(.URL)
						.keyboardType(.URL)
						.textInputAutocapitalization(.never)
						.autocorrectionDisabled()
						.submitLabel(.go)
						.onSubmit(start)
						.accessibilityIdentifier("server")
				}
				if let error {
					Section {
						Text(error).foregroundStyle(.red)
					}
				}
				Section {
					Button(action: start) {
						HStack {
							Spacer()
							if starting {
								ProgressView()
							} else {
								Text("Sign in")
							}
							Spacer()
						}
					}
					.disabled(server.trimmingCharacters(in: .whitespaces).isEmpty || starting)
					.accessibilityIdentifier("sign-in")
				}
			}
			.navigationTitle("V-Pass")
			.sheet(item: $flow, onDismiss: { flow = nil }) { flow in
				SafariView(url: flow.loginURL)
					.ignoresSafeArea()
					.task(id: flow.token) { await poll(flow) }
			}
		}
	}

	private func start() {
		guard !starting else { return }
		error = nil
		starting = true
		Task {
			defer { starting = false }
			do {
				flow = try await LoginFlow().start(serverInput: server)
			} catch {
				self.error = error.localizedDescription
			}
		}
	}

	/// Poll every two seconds while the sign-in sheet is open.
	private func poll(_ session: LoginFlowSession) async {
		let loginFlow = LoginFlow()
		while !Task.isCancelled {
			do {
				if let account = try await loginFlow.poll(session) {
					flow = nil
					await model.connected(account)
					return
				}
			} catch {
				self.error = error.localizedDescription
				flow = nil
				return
			}
			try? await Task.sleep(for: .seconds(2))
		}
	}
}

struct SafariView: UIViewControllerRepresentable {
	let url: URL

	func makeUIViewController(context: Context) -> SFSafariViewController {
		let configuration = SFSafariViewController.Configuration()
		configuration.entersReaderIfAvailable = false
		return SFSafariViewController(url: url, configuration: configuration)
	}

	func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

struct NoVaultView: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		ContentUnavailableView {
			Label("No vault yet", systemImage: "lock.square.stack")
		} description: {
			Text("This Nextcloud account has no V-Pass vault. Create it in the V-Pass web app on your Nextcloud (you choose the master password there), then come back.")
		} actions: {
			Button("Check again") {
				Task { await model.checkForVaultAgain() }
			}
			.buttonStyle(.borderedProminent)
			.disabled(model.busy)
			Button("Disconnect", role: .destructive) {
				Task { await model.disconnect() }
			}
		}
	}
}

struct LockedView: View {
	@Environment(AppModel.self) private var model
	@State private var showRecovery = false

	var body: some View {
		ScrollView {
			VStack {
				Spacer(minLength: 60)
				UnlockForm(
					subtitle: model.account.map { "\($0.loginName) on \(URL(string: $0.server)?.host ?? $0.server)" },
					biometryName: model.biometryName,
					busy: model.busy,
					error: model.unlockError ?? model.syncError,
					onPassword: { password in Task { await model.unlock(password: password) } },
					onBiometrics: { Task { await model.unlockWithBiometrics() } },
					onRecoveryKey: { showRecovery = true }
				)
			}
			.frame(maxWidth: .infinity)
		}
		.sheet(isPresented: $showRecovery) {
			RecoveryKeySheet()
		}
	}
}

private struct RecoveryKeySheet: View {
	@Environment(AppModel.self) private var model
	@Environment(\.dismiss) private var dismiss
	@State private var key = ""

	var body: some View {
		NavigationStack {
			Form {
				Section {
					TextField("ABCD-EFGH-…", text: $key, axis: .vertical)
						.font(.system(.body, design: .monospaced))
						.textInputAutocapitalization(.characters)
						.autocorrectionDisabled()
				} footer: {
					Text("The 56-character key you saved when you created the vault. To set a new master password, use the web app after unlocking.")
				}
				if let error = model.unlockError {
					Section { Text(error).foregroundStyle(.red) }
				}
			}
			.navigationTitle("Recovery key")
			.navigationBarTitleDisplayMode(.inline)
			.toolbar {
				ToolbarItem(placement: .cancellationAction) {
					Button("Cancel") { dismiss() }
				}
				ToolbarItem(placement: .confirmationAction) {
					Button("Unlock") {
						Task {
							await model.unlock(recoveryKey: key)
							if model.phase == .unlocked { dismiss() }
						}
					}
					.disabled(key.isEmpty || model.busy)
				}
			}
		}
	}
}
