import SwiftUI
import VPassKit

/// Every login's one-time code, like an authenticator app: tap a code to copy it,
/// or the info button to open its login.
struct CodesListView: View {
	@Environment(AppModel.self) private var model
	let onOpen: (String) -> Void
	@State private var search = ""
	@State private var copied: String?
	@State private var showImport = false

	private var entries: [CodeEntry] {
		codeEntries(model.snapshot?.items ?? [], query: search)
	}

	var body: some View {
		let list = entries
		TimelineView(.periodic(from: .now, by: 1)) { context in
			List(list) { entry in
				CodeRow(entry: entry, item: model.item(entry.id)?.item, code: totpCode(entry.totp, now: context.date), copied: copied == entry.id) {
					copy(entry)
				} onOpen: {
					onOpen(entry.id)
				}
			}
		}
		.overlay {
			if list.isEmpty {
				if !search.isEmpty {
					ContentUnavailableView.search(text: search)
				} else {
					ContentUnavailableView {
						Label("No 2FA codes yet", systemImage: VaultCategory.codes.symbol)
					} description: {
						Text("Move your codes over from Google Authenticator or another authenticator app, or scan the QR code a website shows in a login's editor.")
					} actions: {
						Button("Import 2FA codes") { showImport = true }
							.buttonStyle(.borderedProminent)
					}
				}
			}
		}
		.searchable(text: $search, prompt: "Search codes")
		.refreshable { await model.sync() }
		.navigationTitle(VaultCategory.codes.title)
		.sheet(isPresented: $showImport) {
			AuthenticatorImportView()
		}
	}

	private func copy(_ entry: CodeEntry) {
		model.copy(totpCode(entry.totp).code, label: "Code for \(entry.name)")
		copied = entry.id
		Task {
			try? await Task.sleep(for: .seconds(1.5))
			if copied == entry.id {
				copied = nil
			}
		}
	}
}

private struct CodeRow: View {
	let entry: CodeEntry
	let item: Item?
	let code: TotpCode
	let copied: Bool
	let onCopy: () -> Void
	let onOpen: () -> Void

	var body: some View {
		HStack(spacing: 12) {
			Button(action: onCopy) {
				HStack(spacing: 12) {
					if let item {
						ItemIcon(item: item)
					}
					VStack(alignment: .leading, spacing: 2) {
						HStack(spacing: 4) {
							Text(entry.name)
								.fontWeight(.medium)
							if !entry.account.isEmpty {
								Text("· \(entry.account)")
									.foregroundStyle(.secondary)
							}
						}
						.font(.subheadline)
						.lineLimit(1)
						Text(formatTotpCode(code.code))
							.font(.system(size: 32, weight: .semibold, design: .monospaced))
							.foregroundStyle(code.remaining <= 5 ? Color.red : Color.accentColor)
							.contentTransition(.numericText())
					}
					Spacer(minLength: 0)
					if copied {
						Image(systemName: "checkmark.circle.fill")
							.font(.title2)
							.foregroundStyle(Color.accentColor)
							.accessibilityHidden(true)
					} else {
						TotpRing(code: code)
					}
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityLabel([entry.name, entry.account, "code \(code.code)"].filter { !$0.isEmpty }.joined(separator: ", "))
			.accessibilityHint("Copies the code")
			.accessibilityIdentifier("code-\(entry.name)")

			Button(action: onOpen) {
				Image(systemName: "info.circle")
					.font(.title3)
			}
			.buttonStyle(.borderless)
			.accessibilityLabel("Open the login")
			.accessibilityIdentifier("code-open-\(entry.name)")
		}
		.padding(.vertical, 4)
	}
}
