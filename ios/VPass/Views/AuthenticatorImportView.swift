import AVFoundation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import VisionKit
import VPassKit

/// Moves one-time codes over from another authenticator app: Google Authenticator's
/// export QR codes (camera or screenshots), an unencrypted export file from Aegis,
/// 2FAS, Ente Auth or Bitwarden Authenticator, or pasted otpauth:// links.
/// Everything is read on the iPhone; the codes go into the matching logins.
struct AuthenticatorImportView: View {
	private enum Stage {
		case collect, review, saving, done
	}

	private struct Note: Equatable {
		var text: String
		var error: Bool
	}

	@Environment(AppModel.self) private var model
	@Environment(\.dismiss) private var dismiss
	@Environment(\.openURL) private var openURL

	@State private var stage = Stage.collect
	@State private var collected = AuthenticatorImport()
	@State private var note: Note?
	@State private var camera = AVCaptureDevice.authorizationStatus(for: .video)
	@State private var scanning = false
	@State private var photos: [PhotosPickerItem] = []
	@State private var choosingFile = false
	@State private var planning = false
	@State private var rows: [AuthenticatorPlanRow] = []
	@State private var saved = 0
	@State private var total = 0
	@State private var failure: String?

	private var cameraReady: Bool {
		DataScannerViewController.isSupported && camera == .authorized && DataScannerViewController.isAvailable
	}

	private var chosen: [AuthenticatorPlanRow] { rows.filter(\.selected) }

	var body: some View {
		NavigationStack {
			Group {
				switch stage {
				case .collect: collect
				case .review: review
				case .saving: saving
				case .done: done
				}
			}
			.navigationTitle("Import 2FA codes")
			.navigationBarTitleDisplayMode(.inline)
			.toolbar { toolbar }
			.alert("Import stopped", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
				Button("OK") {}
			} message: {
				Text(failure ?? "")
			}
		}
		.interactiveDismissDisabled(stage == .saving || (stage != .done && !collected.entries.isEmpty))
	}

	@ToolbarContentBuilder
	private var toolbar: some ToolbarContent {
		switch stage {
		case .collect:
			ToolbarItem(placement: .cancellationAction) {
				Button("Cancel") { dismiss() }
			}
			ToolbarItem(placement: .confirmationAction) {
				Button("Review") { Task { await plan() } }
					.disabled(planning || (collected.entries.isEmpty && collected.skipped.isEmpty))
					.accessibilityIdentifier("otp-review")
			}
		case .review:
			ToolbarItem(placement: .cancellationAction) {
				Button("Back") { stage = .collect }
			}
			ToolbarItem(placement: .confirmationAction) {
				Button("Import \(chosen.count)") { Task { await save() } }
					.disabled(chosen.isEmpty)
					.accessibilityIdentifier("otp-confirm")
			}
		case .saving:
			ToolbarItem(placement: .confirmationAction) { ProgressView() }
		case .done:
			ToolbarItem(placement: .confirmationAction) {
				Button("Done") { dismiss() }
					.accessibilityIdentifier("otp-close")
			}
		}
	}

	/* ----- 1. collect ----- */

	private var collect: some View {
		Form {
			Section {
				Text("Move your one-time codes from Google Authenticator or another authenticator app into your logins. Everything is read on this iPhone and only uploaded encrypted.")
				DisclosureGroup("From Google Authenticator") {
					Text("In Google Authenticator, tap the menu and choose Transfer accounts → Export accounts, then select the accounts to move. It shows one QR code for about every 10 accounts.")
					Text("If it's on this iPhone, take a screenshot of each QR code and choose them below. If it's on another phone, scan each QR code with this iPhone's camera (Android doesn't allow screenshots of them).")
				}
				DisclosureGroup("From other apps") {
					Text("Aegis, 2FAS, Ente Auth and Bitwarden Authenticator: export your codes as an unencrypted file (without a password) and choose it below.")
					Text("Any other app that can show otpauth:// links: copy them and paste them here.")
					Text("Microsoft Authenticator can't export its codes. Set up two-factor authentication again on each site and scan the new QR code in the login's editor.")
				}
			}
			.font(.subheadline)

			if scanning {
				Section {
					if cameraReady {
						QrCameraView { payloads in
							for payload in payloads {
								add(payload, source: "Camera")
							}
						}
						.frame(height: 320)
						.listRowInsets(EdgeInsets())
					} else {
						Text(cameraProblem)
							.foregroundStyle(.secondary)
						if camera == .denied {
							Button("Open Settings") {
								if let url = URL(string: UIApplication.openSettingsURLString) {
									openURL(url)
								}
							}
						}
					}
					Button("Stop camera") { scanning = false }
				} footer: {
					Text("Hold each QR code in front of the camera until it is counted.")
				}
			}

			Section {
				if let note {
					Text(note.text)
						.foregroundStyle(note.error ? Color.red : Color.secondary)
						.accessibilityIdentifier("otp-message")
				}
				Text(found)
					.bold()
					.accessibilityIdentifier("otp-found")
			}

			Section("Add codes") {
				if !scanning {
					Button {
						Task { await startCamera() }
					} label: {
						Label("Scan with camera", systemImage: "camera")
					}
					.accessibilityIdentifier("otp-camera")
				}
				PhotosPicker(selection: $photos, matching: .images) {
					Label("Choose screenshots", systemImage: "photo.on.rectangle")
				}
				.accessibilityIdentifier("otp-screenshots")
				Button {
					choosingFile = true
				} label: {
					Label("Choose an export file", systemImage: "doc")
				}
				.accessibilityIdentifier("otp-files")
				PasteButton(payloadType: String.self) { strings in
					Task { @MainActor in
						add(strings.joined(separator: "\n"), source: "Pasted text")
					}
				}
				if AppGroup.isUITest {
					Button("Simulate scan") { add(DemoVault.googleAuthenticatorExport, source: "Camera") }
						.accessibilityIdentifier("simulate-export-scan")
				}
			}
		}
		.disabled(planning)
		.onChange(of: photos) { _, items in
			guard !items.isEmpty else { return }
			photos = []
			Task { await read(items) }
		}
		.fileImporter(isPresented: $choosingFile, allowedContentTypes: [.data], allowsMultipleSelection: true) { result in
			switch result {
			case .success(let urls):
				Task {
					for url in urls {
						await read(url)
					}
				}
			case .failure(let error):
				note = Note(text: error.localizedDescription, error: true)
			}
		}
	}

	private var found: String {
		let count = collected.entries.count
		var text = count == 1 ? "1 code found" : "\(count) codes found"
		if let progress = collected.progress {
			text += " · Google Authenticator QR code \(progress.scanned) of \(progress.total) scanned"
		}
		return text
	}

	private var cameraProblem: String {
		if !DataScannerViewController.isSupported {
			return "This device can't scan with its camera. Take screenshots of the QR codes and choose them instead."
		}
		switch camera {
		case .denied, .restricted:
			return "V-Pass isn't allowed to use the camera. Allow it in Settings, or choose screenshots instead."
		case .notDetermined:
			return "Waiting for camera access…"
		default:
			return "The camera is busy or unavailable right now. You can choose screenshots instead."
		}
	}

	private func startCamera() async {
		scanning = true
		// Ask once, and only where the scanner can run (never on the simulator).
		if DataScannerViewController.isSupported && camera == .notDetermined {
			_ = await AVCaptureDevice.requestAccess(for: .video)
			camera = AVCaptureDevice.authorizationStatus(for: .video)
		}
	}

	/// Add one QR code, file or paste; `source` names it in the message.
	private func add(_ text: String, source: String) {
		do {
			let result = try collected.add(text)
			if result.repeated {
				return
			}
			var parts = [result.added == 1 ? "1 new code" : "\(result.added) new codes"]
			if result.skipped > 0 {
				parts.append("\(result.skipped) that can't be imported")
			}
			note = Note(text: "\(source): \(parts.joined(separator: ", "))", error: false)
		} catch {
			note = Note(text: "\(source): \(error.localizedDescription)", error: true)
		}
	}

	private func read(_ items: [PhotosPickerItem]) async {
		for (i, item) in items.enumerated() {
			let name = items.count == 1 ? "Screenshot" : "Screenshot \(i + 1)"
			guard let data = try? await item.loadTransferable(type: Data.self) else {
				note = Note(text: "\(name) couldn't be opened.", error: true)
				continue
			}
			await addCodes(inImageData: data, source: name)
		}
	}

	private func read(_ url: URL) async {
		let name = url.lastPathComponent
		let access = url.startAccessingSecurityScopedResource()
		defer {
			if access {
				url.stopAccessingSecurityScopedResource()
			}
		}
		do {
			if let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 5_000_000 {
				note = Note(text: "\(name) is too big to be an authenticator export.", error: true)
				return
			}
			let data = try Data(contentsOf: url)
			if UTType(filenameExtension: url.pathExtension)?.conforms(to: .image) == true {
				await addCodes(inImageData: data, source: name)
			} else if let text = String(data: data, encoding: .utf8) {
				add(text, source: name)
			} else {
				note = Note(text: "\(name) isn't a text file or an image.", error: true)
			}
		} catch {
			note = Note(text: "\(name) couldn't be read: \(error.localizedDescription)", error: true)
		}
	}

	private func addCodes(inImageData data: Data, source: String) async {
		let payloads = await Task.detached { qrPayloads(inImageData: data) }.value
		if payloads.isEmpty {
			note = Note(text: "\(source): no QR code found in this image", error: true)
		}
		for payload in payloads {
			add(payload, source: source)
		}
	}

	/* ----- 2. review ----- */

	private var review: some View {
		List {
			Section {
				ForEach($rows) { $row in
					if row.action == .exists {
						Label {
							rowText(row)
						} icon: {
							Image(systemName: "checkmark.circle.fill")
								.foregroundStyle(.green)
						}
						.accessibilityElement(children: .combine)
						.accessibilityIdentifier("otp-row-\(name(row.entry))")
					} else {
						Toggle(isOn: $row.selected) {
							rowText(row)
						}
						.accessibilityIdentifier("otp-row-\(name(row.entry))")
					}
				}
			} footer: {
				Text("Codes already in V-Pass are left as they are. A code that would replace a different one in a login is only imported if you turn it on.")
			}
			if !collected.skipped.isEmpty {
				Section(collected.skipped.count == 1 ? "1 code can't be imported" : "\(collected.skipped.count) codes can't be imported") {
					ForEach(Array(collected.skipped.enumerated()), id: \.offset) { _, skip in
						let label = [skip.issuer, skip.account].filter { !$0.isEmpty }.joined(separator: " · ")
						Text("\(label.isEmpty ? "Unnamed code" : label): \(skip.reason)")
							.font(.subheadline)
					}
				}
			}
		}
	}

	private func rowText(_ row: AuthenticatorPlanRow) -> some View {
		VStack(alignment: .leading, spacing: 2) {
			Text(name(row.entry))
			if !row.entry.issuer.isEmpty && !row.entry.account.isEmpty {
				Text(row.entry.account)
					.font(.subheadline)
					.foregroundStyle(.secondary)
			}
			Text(describe(row))
				.font(.footnote)
				.foregroundStyle(row.action == .replace ? Color.orange : Color.secondary)
		}
	}

	private func name(_ entry: AuthenticatorEntry) -> String {
		!entry.issuer.isEmpty ? entry.issuer : !entry.account.isEmpty ? entry.account : "Unnamed code"
	}

	private func loginName(_ id: String?) -> String {
		guard let id, let entry = model.item(id) else {
			return ""
		}
		let title = itemDisplayTitle(entry.item)
		let username = entry.item.type == .login ? entry.item.username : ""
		return username.isEmpty ? title : "\(title) (\(username))"
	}

	private func describe(_ row: AuthenticatorPlanRow) -> String {
		switch row.action {
		case .add: "Goes into \(loginName(row.itemId))"
		case .replace: "Replaces the different code in \(loginName(row.itemId))"
		case .exists: "Already in \(loginName(row.itemId))"
		case .new: "New login"
		}
	}

	/// Plan against the latest vault, so codes saved on another device show as already there.
	private func plan() async {
		scanning = false
		planning = true
		await model.sync()
		rows = planAuthenticatorImport(collected.entries, items: model.snapshot?.items ?? [])
		planning = false
		stage = .review
	}

	/* ----- 3. saving, 4. done ----- */

	private var saving: some View {
		VStack(spacing: 12) {
			ProgressView(value: Double(saved), total: Double(max(total, 1)))
			Text("Encrypting and saving… \(saved) of \(total)")
				.foregroundStyle(.secondary)
		}
		.padding()
	}

	private var done: some View {
		ContentUnavailableView {
			Label(saved == 1 ? "1 code was imported" : "\(saved) codes were imported", systemImage: "checkmark.circle")
				.accessibilityIdentifier("otp-done")
		} description: {
			Text("Delete the screenshots of the QR codes from Photos now, and any export files: they aren't encrypted. Keep the codes in your old app until you have signed in with a few of them from V-Pass.")
		} actions: {
			Button("Import more codes") {
				collected = AuthenticatorImport()
				rows = []
				note = nil
				stage = .collect
			}
		}
	}

	private func save() async {
		let selected = chosen
		saved = 0
		total = selected.count
		stage = .saving
		do {
			try await model.importAuthenticatorCodes(selected) { saved += 1 }
			stage = .done
		} catch {
			failure = "\(error.localizedDescription). Codes imported so far were kept."
			// Plan again: the codes saved before the failure now show as already there.
			await plan()
		}
	}
}
