import SwiftUI
import VPassKit

struct ItemEditorView: View {
	enum Mode {
		case create(ItemType, folderId: String?)
		case edit(DecryptedItem)
	}

	@Environment(AppModel.self) private var model
	@Environment(\.dismiss) private var dismiss
	let mode: Mode
	var onSaved: ((DecryptedItem) -> Void)?

	@State private var draft: Item
	/// The version the edit is based on (replaced by the server's copy after a conflict).
	@State private var base: DecryptedItem?
	@State private var urls: [EditableText]
	@State private var fields: [CustomField]
	@State private var saving = false
	@State private var error: String?
	@State private var showGenerator = false
	@State private var showScanner = false
	@State private var revealPassword = false
	@State private var newFolderName = ""
	@State private var askFolderName = false

	init(mode: Mode, onSaved: ((DecryptedItem) -> Void)? = nil) {
		self.mode = mode
		self.onSaved = onSaved
		let item: Item
		switch mode {
		case let .create(type, folderId):
			var fresh = Item.new(type)
			fresh.folderId = folderId
			item = fresh
			_base = State(initialValue: nil)
		case let .edit(entry):
			item = entry.item
			_base = State(initialValue: entry)
		}
		_draft = State(initialValue: item)
		_urls = State(initialValue: item.urls.map { EditableText(value: $0) } + (item.type == .login && item.urls.isEmpty ? [EditableText(value: "")] : []))
		_fields = State(initialValue: item.customFields)
	}

	private var isNew: Bool {
		if case .create = mode { return true }
		return false
	}

	private var totpInvalid: Bool {
		draft.type == .login && !draft.totp.trimmingCharacters(in: .whitespaces).isEmpty && (try? parseTotp(draft.totp)) == nil
	}

	var body: some View {
		NavigationStack {
			Form {
				Section {
					TextField("Title", text: $draft.title)
						.accessibilityIdentifier("edit-title")
				}
				switch draft.type {
				case .login: loginFields
				case .card: cardFields
				case .identity: identityFields
				case .note: EmptyView()
				}
				Section("Notes") {
					TextField("Notes", text: $draft.notes, axis: .vertical)
						.lineLimit(3...12)
				}
				customFieldsSection
				Section {
					Picker("Folder", selection: $draft.folderId) {
						Text("None").tag(String?.none)
						ForEach(model.snapshot?.folders ?? [], id: \.id) { folder in
							Text(folder.name).tag(Optional(folder.id))
						}
					}
					Button("New folder…") { askFolderName = true }
					Toggle("Favorite", isOn: $draft.favorite)
				}
				if let error {
					Section { Text(error).foregroundStyle(.red) }
				}
			}
			.navigationTitle(isNew ? "New item" : "Edit")
			.navigationBarTitleDisplayMode(.inline)
			.toolbar {
				ToolbarItem(placement: .cancellationAction) {
					Button("Cancel") { dismiss() }
				}
				ToolbarItem(placement: .confirmationAction) {
					if saving {
						ProgressView()
					} else {
						Button("Save", action: save)
							.disabled(totpInvalid)
							.accessibilityIdentifier("save")
					}
				}
			}
			.sheet(isPresented: $showGenerator) {
				GeneratorView { password in
					draft.password = password
					revealPassword = true
				}
			}
			.sheet(isPresented: $showScanner) {
				QrScannerView(onScan: useScannedKey)
			}
			.alert("New folder", isPresented: $askFolderName) {
				TextField("Name", text: $newFolderName)
				Button("Create") {
					let name = newFolderName.trimmingCharacters(in: .whitespaces)
					newFolderName = ""
					guard !name.isEmpty else { return }
					Task {
						if let id = await model.createFolder(name) {
							draft.folderId = id
						}
					}
				}
				Button("Cancel", role: .cancel) {}
			}
			.interactiveDismissDisabled(saving)
		}
	}

	@ViewBuilder
	private var loginFields: some View {
		Section("Login") {
			TextField("Username or email", text: $draft.username)
				.textContentType(.username)
				.textInputAutocapitalization(.never)
				.autocorrectionDisabled()
				.accessibilityIdentifier("edit-username")
			HStack {
				Group {
					if revealPassword {
						TextField("Password", text: $draft.password)
					} else {
						SecureField("Password", text: $draft.password)
					}
				}
				.font(.system(.body, design: .monospaced))
				.textInputAutocapitalization(.never)
				.autocorrectionDisabled()
				.accessibilityIdentifier("edit-password")
				Button {
					revealPassword.toggle()
				} label: {
					Image(systemName: revealPassword ? "eye.slash" : "eye")
				}
				.buttonStyle(.borderless)
				Button {
					showGenerator = true
				} label: {
					Image(systemName: "wand.and.stars")
				}
				.buttonStyle(.borderless)
				.accessibilityLabel("Generate password")
				.accessibilityIdentifier("generate")
			}
		}
		Section("Websites") {
			ForEach($urls) { $url in
				TextField("https://example.com", text: $url.value)
					.keyboardType(.URL)
					.textInputAutocapitalization(.never)
					.autocorrectionDisabled()
			}
			.onDelete { urls.remove(atOffsets: $0) }
			Button("Add website") { urls.append(EditableText(value: "")) }
		}
		Section {
			TextField("Authenticator key or otpauth:// link", text: $draft.totp)
				.textInputAutocapitalization(.never)
				.autocorrectionDisabled()
				.font(.system(.body, design: .monospaced))
				.accessibilityIdentifier("edit-totp")
			Button {
				showScanner = true
			} label: {
				Label("Scan QR code", systemImage: "qrcode.viewfinder")
			}
			.accessibilityIdentifier("scan-qr")
			if totpInvalid {
				Text("Not a valid authenticator key or otpauth:// link").font(.footnote).foregroundStyle(.red)
			} else if !draft.totp.isEmpty {
				TotpCodeView(secret: draft.totp)
			}
		} header: {
			Text("One-time codes (2FA)")
		}
	}

	/// A scanned key also names a new login: the QR code carries the site (issuer) and the account.
	private func useScannedKey(_ uri: String) {
		draft.totp = uri
		guard let params = try? parseTotp(uri) else { return }
		if draft.title.trimmingCharacters(in: .whitespaces).isEmpty {
			draft.title = params.issuer
		}
		if draft.username.trimmingCharacters(in: .whitespaces).isEmpty {
			draft.username = params.account
		}
	}

	private func text(_ key: String) -> Binding<String> {
		Binding(get: { draft.text(key) }, set: { draft.setText(key, $0) })
	}

	@ViewBuilder
	private var cardFields: some View {
		Section("Card") {
			TextField("Cardholder name", text: text("cardholderName"))
				.textContentType(.name)
			TextField("Card number", text: text("number"))
				.keyboardType(.numberPad)
				.textContentType(.creditCardNumber)
				.font(.system(.body, design: .monospaced))
			HStack {
				TextField("MM", text: text("expMonth")).keyboardType(.numberPad)
				Text("/")
				TextField("YYYY", text: text("expYear")).keyboardType(.numberPad)
			}
			TextField("Security code", text: text("cvc")).keyboardType(.numberPad)
			TextField("PIN", text: text("pin")).keyboardType(.numberPad)
			TextField("ZIP / postal code", text: text("zip"))
		}
	}

	@ViewBuilder
	private var identityFields: some View {
		Section("Name") {
			TextField("First name", text: text("firstName")).textContentType(.givenName)
			TextField("Middle name", text: text("middleName")).textContentType(.middleName)
			TextField("Last name", text: text("lastName")).textContentType(.familyName)
		}
		Section("Details") {
			ForEach(IdentityField.all, id: \.key) { field in
				TextField(field.label, text: text(field.key))
					.textInputAutocapitalization(field.key == "email" ? .never : .sentences)
					.keyboardType(field.key == "email" ? .emailAddress : field.key == "phone" ? .phonePad : .default)
			}
		}
	}

	private var customFieldsSection: some View {
		Section("Custom fields") {
			ForEach($fields) { $field in
				VStack(alignment: .leading) {
					HStack {
						TextField("Label", text: $field.label).font(.caption)
						Picker("Type", selection: $field.kind) {
							Text("Text").tag(CustomField.Kind.text)
							Text("Hidden").tag(CustomField.Kind.hidden)
						}
						.labelsHidden()
					}
					if field.kind == .hidden {
						SecureField("Value", text: $field.value)
					} else {
						TextField("Value", text: $field.value)
					}
				}
			}
			.onDelete { fields.remove(atOffsets: $0) }
			Button("Add field") { fields.append(CustomField()) }
		}
	}

	private func save() {
		var item = draft
		if item.type == .login {
			item.urls = urls.map { $0.value.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
			item.totp = item.totp.trimmingCharacters(in: .whitespacesAndNewlines)
		}
		item.customFields = fields
		saving = true
		error = nil
		Task {
			defer { saving = false }
			do {
				let saved: DecryptedItem
				if let base {
					saved = try await model.save(id: base.id, base: base, edited: item)
				} else {
					saved = try await model.create(item)
				}
				onSaved?(saved)
				dismiss()
			} catch let conflict as EditConflictError {
				// Keep the user's draft; the next save goes on top of the server's copy.
				base = conflict.server
				error = "This item was changed on another device while you were editing. Save again to replace that version with yours, or Cancel to keep it."
			} catch {
				self.error = error.localizedDescription
			}
		}
	}
}

struct EditableText: Identifiable {
	let id = UUID()
	var value: String
}
