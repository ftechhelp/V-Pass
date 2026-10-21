import AVFoundation
import PhotosUI
import SwiftUI
import Vision
import VisionKit
import VPassKit

/// Reads a website's 2FA setup QR code (otpauth://totp/…) with the camera, or
/// from a screenshot: the way in when the code is on this iPhone's own screen.
struct QrScannerView: View {
	@Environment(\.dismiss) private var dismiss
	@Environment(\.openURL) private var openURL
	let onScan: (String) -> Void

	@State private var camera = AVCaptureDevice.authorizationStatus(for: .video)
	@State private var photo: PhotosPickerItem?
	@State private var message: String?
	@State private var done = false

	private var cameraReady: Bool {
		DataScannerViewController.isSupported && camera == .authorized && DataScannerViewController.isAvailable
	}

	var body: some View {
		NavigationStack {
			VStack(spacing: 16) {
				if cameraReady {
					QrCameraView { payloads in
						if let uri = firstTotp(in: payloads) {
							finish(uri)
						} else {
							message = "This QR code isn't a 2FA setup code."
						}
					}
					.clipShape(RoundedRectangle(cornerRadius: 12))
				} else {
					ContentUnavailableView {
						Label("Camera not available", systemImage: "camera")
					} description: {
						Text(cameraProblem)
					} actions: {
						if camera == .denied {
							Button("Open Settings") {
								if let url = URL(string: UIApplication.openSettingsURLString) {
									openURL(url)
								}
							}
						}
					}
				}
				Text(message ?? "Point the camera at the QR code the website shows when you turn on two-factor authentication.")
					.font(.footnote)
					.foregroundStyle(message == nil ? Color.secondary : Color.red)
					.multilineTextAlignment(.center)
					.accessibilityIdentifier("scan-message")
				PhotosPicker(selection: $photo, matching: .images) {
					Label("Choose a screenshot", systemImage: "photo.on.rectangle")
				}
				.buttonStyle(.bordered)
				.accessibilityIdentifier("choose-screenshot")
				if AppGroup.isUITest {
					Button("Simulate scan") { finish(DemoVault.setupQRCode) }
						.accessibilityIdentifier("simulate-scan")
				}
			}
			.padding()
			.navigationTitle("Scan QR code")
			.navigationBarTitleDisplayMode(.inline)
			.toolbar {
				ToolbarItem(placement: .cancellationAction) {
					Button("Cancel") { dismiss() }
				}
			}
			.task {
				// Ask once, and only where the scanner can run (never on the simulator).
				if DataScannerViewController.isSupported && camera == .notDetermined {
					_ = await AVCaptureDevice.requestAccess(for: .video)
					camera = AVCaptureDevice.authorizationStatus(for: .video)
				}
			}
			.onChange(of: photo) { _, item in
				if let item {
					Task { await read(item) }
				}
			}
		}
	}

	private var cameraProblem: String {
		if !DataScannerViewController.isSupported {
			return "This device can't scan with its camera. Take a screenshot of the QR code and choose it below."
		}
		switch camera {
		case .denied, .restricted:
			return "V-Pass isn't allowed to use the camera. Allow it in Settings, or choose a screenshot of the QR code below."
		case .notDetermined:
			return "Waiting for camera access…"
		default:
			return "The camera is busy or unavailable right now. You can choose a screenshot of the QR code instead."
		}
	}

	private func read(_ item: PhotosPickerItem) async {
		photo = nil
		message = nil
		guard let data = try? await item.loadTransferable(type: Data.self) else {
			message = "That image couldn't be opened."
			return
		}
		let payloads = await Task.detached { qrPayloads(inImageData: data) }.value
		if let uri = firstTotp(in: payloads) {
			finish(uri)
		} else {
			message = payloads.isEmpty ? "No QR code found in this image." : "This QR code isn't a 2FA setup code."
		}
	}

	private func finish(_ uri: String) {
		guard !done else { return }
		done = true
		onScan(uri)
		dismiss()
	}
}

/// VisionKit's live scanner, looking only for QR codes.
private struct QrCameraView: UIViewControllerRepresentable {
	let onCodes: ([String]) -> Void

	func makeUIViewController(context: Context) -> DataScannerViewController {
		let scanner = DataScannerViewController(
			recognizedDataTypes: [.barcode(symbologies: [.qr])],
			recognizesMultipleItems: true,
			isHighlightingEnabled: true
		)
		scanner.delegate = context.coordinator
		return scanner
	}

	func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
		context.coordinator.onCodes = onCodes
		if !scanner.isScanning {
			try? scanner.startScanning()
		}
	}

	static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
		scanner.stopScanning()
	}

	func makeCoordinator() -> Coordinator {
		Coordinator(onCodes: onCodes)
	}

	@MainActor
	final class Coordinator: NSObject, DataScannerViewControllerDelegate {
		var onCodes: ([String]) -> Void

		init(onCodes: @escaping ([String]) -> Void) {
			self.onCodes = onCodes
		}

		func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
			let payloads = allItems.compactMap { item -> String? in
				if case let .barcode(barcode) = item {
					return barcode.payloadStringValue
				}
				return nil
			}
			if !payloads.isEmpty {
				onCodes(payloads)
			}
		}
	}
}
