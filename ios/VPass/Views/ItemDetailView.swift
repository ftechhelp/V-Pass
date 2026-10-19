import SwiftUI
import VPassKit

struct ItemDetailView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.openURL) private var openURL
	let id: String
	@State private var editing = false

	var body: some View {
		if let entry = model.item(id) {
			content(entry)
		} else {
			ContentUnavailableView("This item was deleted", systemImage: "trash")
		}
	}

	private func content(_ entry: DecryptedItem) -> some View {
		let item = entry.item
		return List {
			Section {
				HStack(spacing: 14) {
					ItemIcon(item: item, size: 48)
					VStack(alignment: .leading) {
						Text(itemDisplayTitle(item)).font(.title3.bold())
						if let folder = model.snapshot?.folderName(item.folderId) {
							Label(folder, systemImage: "folder").font(.subheadline).foregroundStyle(.secondary)
						}
					}
				}
				.padding(.vertical, 4)
			}
			switch item.type {
			case .login: loginSections(item)
			case .card: cardSection(item)
			case .identity: identitySection(item)
			case .note: EmptyView()
			}
			if !item.notes.isEmpty {
				Section("Notes") {
					Text(item.notes)
						.textSelection(.enabled)
						.contextMenu {
							Button("Copy") { model.copy(item.notes, label: "Notes") }
						}
				}
			}
			if !item.customFields.isEmpty {
				Section("Custom fields") {
					ForEach(Array(item.customFields.enumerated()), id: \.offset) { _, field in
						FieldRow(label: field.label.isEmpty ? "Field" : field.label, value: field.value, secret: field.kind == .hidden)
					}
				}
			}
			Section {
				LabeledContent("Modified", value: Date(timeIntervalSince1970: TimeInterval(entry.updatedAt)).formatted(date: .abbreviated, time: .shortened))
				if item.type == .login, !item.passwordHistory.isEmpty {
					LabeledContent("Earlier passwords", value: "\(item.passwordHistory.count)")
				}
			}
			.font(.footnote)
			.foregroundStyle(.secondary)
		}
		.navigationTitle(itemDisplayTitle(item))
		.navigationBarTitleDisplayMode(.inline)
		.toolbar {
			if entry.inTrash {
				ToolbarItem {
					Button("Restore") { Task { await model.restore(entry.id) } }
				}
			} else {
				ToolbarItemGroup(placement: .topBarTrailing) {
					Button {
						Task { await model.toggleFavorite(entry) }
					} label: {
						Label(item.favorite ? "Unfavorite" : "Favorite", systemImage: item.favorite ? "star.fill" : "star")
					}
					Button("Edit") { editing = true }
						.accessibilityIdentifier("edit")
				}
				ToolbarItem(placement: .bottomBar) {
					Button(role: .destructive) {
						Task { await model.trash(entry.id) }
					} label: {
						Label("Move to trash", systemImage: "trash")
					}
				}
			}
		}
		.sheet(isPresented: $editing) {
			ItemEditorView(mode: .edit(entry))
		}
	}

	@ViewBuilder
	private func loginSections(_ item: Item) -> some View {
		Section {
			if !item.username.isEmpty {
				FieldRow(label: "Username", value: item.username)
			}
			if !item.password.isEmpty {
				FieldRow(label: "Password", value: item.password, secret: true)
			}
			if !item.totp.isEmpty {
				VStack(alignment: .leading, spacing: 4) {
					Text("One-time code").font(.caption).foregroundStyle(.secondary)
					TotpCodeView(secret: item.totp) { code in model.copy(code, label: "Code") }
				}
			}
		}
		if !item.urls.isEmpty {
			Section("Websites") {
				ForEach(item.urls, id: \.self) { url in
					Button {
						if let target = URL(string: normaliseUrl(url)) { openURL(target) }
					} label: {
						HStack {
							Text(url).lineLimit(1)
							Spacer()
							Image(systemName: "arrow.up.right.square")
						}
					}
					.contextMenu {
						Button("Copy") { model.copy(url, label: "Website") }
					}
				}
			}
		}
		if !item.passkeys.isEmpty {
			Section("Passkeys") {
				ForEach(item.passkeys, id: \.credentialId) { passkey in
					VStack(alignment: .leading) {
						Label(passkey.rpId, systemImage: "person.badge.key")
						if !passkey.userName.isEmpty {
							Text(passkey.userName).font(.subheadline).foregroundStyle(.secondary)
						}
					}
				}
			}
		}
	}

	private func cardSection(_ item: Item) -> some View {
		Section {
			FieldRow(label: "Cardholder", value: item.text("cardholderName"))
			FieldRow(label: "Number", value: item.text("number"), secret: true, display: formatCardNumber(item.text("number")))
			if !item.text("expMonth").isEmpty || !item.text("expYear").isEmpty {
				FieldRow(label: "Expires", value: "\(item.text("expMonth"))/\(item.text("expYear"))")
			}
			FieldRow(label: "Security code", value: item.text("cvc"), secret: true)
			FieldRow(label: "PIN", value: item.text("pin"), secret: true)
			FieldRow(label: "ZIP / postal code", value: item.text("zip"))
		}
	}

	private func identitySection(_ item: Item) -> some View {
		Section {
			FieldRow(label: "Name", value: fullName(item))
			ForEach(IdentityField.all, id: \.key) { field in
				FieldRow(label: field.label, value: item.text(field.key))
			}
		}
	}
}

/// A copyable value; secrets are hidden until revealed.
struct FieldRow: View {
	@Environment(AppModel.self) private var model
	let label: String
	let value: String
	var secret = false
	var display: String?
	@State private var revealed = false

	var body: some View {
		if !value.isEmpty {
			HStack {
				VStack(alignment: .leading, spacing: 2) {
					Text(label).font(.caption).foregroundStyle(.secondary)
					Text(secret && !revealed ? String(repeating: "•", count: 10) : (display ?? value))
						.font(secret ? .system(.body, design: .monospaced) : .body)
						.textSelection(.enabled)
						.lineLimit(revealed ? nil : 1)
						.accessibilityIdentifier("value-\(label)")
				}
				Spacer()
				if secret {
					Button {
						revealed.toggle()
					} label: {
						Image(systemName: revealed ? "eye.slash" : "eye")
					}
					.buttonStyle(.borderless)
					.accessibilityLabel(revealed ? "Hide \(label)" : "Show \(label)")
				}
				Button {
					model.copy(value, label: label)
				} label: {
					Image(systemName: "doc.on.doc")
				}
				.buttonStyle(.borderless)
				.accessibilityLabel("Copy \(label)")
				.accessibilityIdentifier("copy-\(label)")
			}
		}
	}
}

struct IdentityField {
	let key: String
	let label: String

	static let all = [
		IdentityField(key: "email", label: "Email"),
		IdentityField(key: "phone", label: "Phone"),
		IdentityField(key: "company", label: "Company"),
		IdentityField(key: "address1", label: "Address"),
		IdentityField(key: "address2", label: "Address line 2"),
		IdentityField(key: "city", label: "City"),
		IdentityField(key: "state", label: "State / region"),
		IdentityField(key: "zip", label: "ZIP / postal code"),
		IdentityField(key: "country", label: "Country"),
		IdentityField(key: "birthday", label: "Birthday"),
	]
}
