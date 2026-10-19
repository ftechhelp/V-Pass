import SwiftUI
import VPassKit

enum VaultCategory: Hashable {
	case all, favorites, logins, passkeys, notes, cards, identities, trash
	case folder(String)

	var title: String {
		switch self {
		case .all: "All items"
		case .favorites: "Favorites"
		case .logins: "Logins"
		case .passkeys: "Passkeys"
		case .notes: "Secure notes"
		case .cards: "Credit cards"
		case .identities: "Personal info"
		case .trash: "Trash"
		case .folder: "Folder"
		}
	}

	var symbol: String {
		switch self {
		case .all: "tray.full"
		case .favorites: "star"
		case .logins: "key"
		case .passkeys: "person.badge.key"
		case .notes: "note.text"
		case .cards: "creditcard"
		case .identities: "person.text.rectangle"
		case .trash: "trash"
		case .folder: "folder"
		}
	}

	func contains(_ entry: DecryptedItem) -> Bool {
		if self == .trash {
			return entry.inTrash
		}
		if entry.inTrash {
			return false
		}
		let item = entry.item
		switch self {
		case .all, .trash: return true
		case .favorites: return item.favorite
		case .logins: return item.type == .login
		case .passkeys: return item.type == .login && !item.passkeys.isEmpty
		case .notes: return item.type == .note
		case .cards: return item.type == .card
		case .identities: return item.type == .identity
		case let .folder(id): return item.folderId == id
		}
	}
}

struct VaultView: View {
	@Environment(AppModel.self) private var model
	@State private var category: VaultCategory? = .all
	@State private var selection: String?
	@State private var compactColumn = NavigationSplitViewColumn.content
	@State private var showSettings = false
	@State private var creating: ItemType?

	var body: some View {
		NavigationSplitView(preferredCompactColumn: $compactColumn) {
			SidebarView(selection: $category)
				.navigationTitle("V-Pass")
				.toolbar { toolbar }
		} content: {
			ItemListView(category: category ?? .all, selection: $selection)
				.toolbar { toolbar }
		} detail: {
			if let selection, model.item(selection) != nil {
				ItemDetailView(id: selection)
			} else {
				ContentUnavailableView("Select an item", systemImage: "key.viewfinder")
			}
		}
		.sheet(isPresented: $showSettings) {
			SettingsView()
		}
		.sheet(item: $creating) { type in
			ItemEditorView(mode: .create(type, folderId: folderForNewItems)) { saved in
				selection = saved.id
			}
		}
	}

	private var folderForNewItems: String? {
		if case let .folder(id) = category {
			return id
		}
		return nil
	}

	@ToolbarContentBuilder
	private var toolbar: some ToolbarContent {
		ToolbarItem(placement: .topBarLeading) {
			Button {
				model.lock()
			} label: {
				Label("Lock", systemImage: "lock")
			}
			.accessibilityIdentifier("lock")
		}
		ToolbarItemGroup(placement: .topBarTrailing) {
			Button {
				showSettings = true
			} label: {
				Label("Settings", systemImage: "gearshape")
			}
			.accessibilityIdentifier("settings")
			Menu {
				Button { creating = .login } label: { Label("Login", systemImage: "key") }
				Button { creating = .note } label: { Label("Secure note", systemImage: "note.text") }
				Button { creating = .card } label: { Label("Credit card", systemImage: "creditcard") }
				Button { creating = .identity } label: { Label("Personal info", systemImage: "person.text.rectangle") }
			} label: {
				Label("New item", systemImage: "plus")
			}
			.accessibilityIdentifier("new-item")
		}
	}
}

private struct SidebarView: View {
	@Environment(AppModel.self) private var model
	@Binding var selection: VaultCategory?

	private let fixed: [VaultCategory] = [.all, .favorites, .logins, .passkeys, .notes, .cards, .identities]

	var body: some View {
		List(selection: $selection) {
			Section {
				ForEach(fixed, id: \.self) { category in
					row(category, title: category.title)
				}
			}
			if let folders = model.snapshot?.folders, !folders.isEmpty {
				Section("Folders") {
					ForEach(folders, id: \.id) { folder in
						row(.folder(folder.id), title: folder.name)
					}
				}
			}
			Section {
				row(.trash, title: VaultCategory.trash.title)
			}
		}
		.refreshable { await model.sync() }
	}

	private func row(_ category: VaultCategory, title: String) -> some View {
		NavigationLink(value: category) {
			HStack {
				Label(title, systemImage: category.symbol)
				Spacer()
				Text("\(count(category))")
					.foregroundStyle(.secondary)
					.font(.subheadline)
			}
		}
	}

	private func count(_ category: VaultCategory) -> Int {
		model.snapshot?.items.filter { category.contains($0) }.count ?? 0
	}
}

struct ItemListView: View {
	@Environment(AppModel.self) private var model
	let category: VaultCategory
	@Binding var selection: String?
	@State private var search = ""

	private var entries: [DecryptedItem] {
		let query = search.trimmingCharacters(in: .whitespaces).lowercased()
		return (model.snapshot?.items ?? [])
			.filter { category.contains($0) }
			.filter { query.isEmpty || itemSearchText($0.item).contains(query) }
			.sorted { itemDisplayTitle($0.item).localizedCaseInsensitiveCompare(itemDisplayTitle($1.item)) == .orderedAscending }
	}

	private var title: String {
		if case let .folder(id) = category {
			return model.snapshot?.folderName(id) ?? "Folder"
		}
		return category.title
	}

	var body: some View {
		List(selection: $selection) {
			ForEach(entries, id: \.id) { entry in
				NavigationLink(value: entry.id) {
					ItemRow(item: entry.item)
				}
				.accessibilityIdentifier("item-\(itemDisplayTitle(entry.item))")
				.contextMenu { quickActions(entry) }
				.swipeActions(edge: .trailing) {
					if entry.inTrash {
						Button {
							Task { await model.restore(entry.id) }
						} label: {
							Label("Restore", systemImage: "arrow.uturn.backward")
						}
						.tint(.blue)
					} else {
						Button(role: .destructive) {
							Task { await model.trash(entry.id) }
						} label: {
							Label("Trash", systemImage: "trash")
						}
					}
				}
				.swipeActions(edge: .leading) {
					if entry.item.type == .login, !entry.item.password.isEmpty {
						Button {
							model.copy(entry.item.password, label: "Password")
						} label: {
							Label("Copy password", systemImage: "key")
						}
						.tint(.blue)
					}
				}
			}
		}
		.overlay {
			if entries.isEmpty {
				if search.isEmpty {
					ContentUnavailableView(category == .trash ? "Trash is empty" : "No items", systemImage: category.symbol)
				} else {
					ContentUnavailableView.search(text: search)
				}
			}
		}
		.searchable(text: $search, prompt: "Search")
		.refreshable { await model.sync() }
		.navigationTitle(title)
		.safeAreaInset(edge: .bottom) {
			if let error = model.syncError {
				Label("Offline: \(error)", systemImage: "wifi.exclamationmark")
					.font(.footnote)
					.foregroundStyle(.secondary)
					.padding(8)
					.frame(maxWidth: .infinity)
					.background(.bar)
			}
		}
	}

	@ViewBuilder
	private func quickActions(_ entry: DecryptedItem) -> some View {
		let item = entry.item
		if item.type == .login {
			if !item.username.isEmpty {
				Button("Copy username") { model.copy(item.username, label: "Username") }
			}
			if !item.password.isEmpty {
				Button("Copy password") { model.copy(item.password, label: "Password") }
			}
			if let params = try? parseTotp(item.totp) {
				Button("Copy one-time code") { model.copy(totpCode(params).code, label: "Code") }
			}
		}
		if item.type == .card, !item.text("number").isEmpty {
			Button("Copy card number") { model.copy(item.text("number"), label: "Card number") }
		}
	}
}
