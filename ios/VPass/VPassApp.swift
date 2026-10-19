import SwiftUI
import VPassKit

@main
struct VPassApp: App {
	@State private var model = AppModel()
	@Environment(\.scenePhase) private var scenePhase

	var body: some Scene {
		WindowGroup {
			RootView()
				.environment(model)
				.task { await model.start() }
				.onChange(of: scenePhase) { _, phase in
					model.scenePhaseChanged(phase)
				}
		}
	}
}

struct RootView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.scenePhase) private var scenePhase

	var body: some View {
		ZStack {
			switch model.phase {
			case .loading:
				ProgressView("Loading…")
			case .connect:
				ConnectView()
			case .noVault:
				NoVaultView()
			case .locked:
				LockedView()
			case .unlocked:
				VaultView()
			}
			// Hide the vault in the app switcher.
			if scenePhase != .active && model.phase == .unlocked {
				PrivacyCover()
			}
		}
		.overlay(alignment: .bottom) {
			BannerView()
		}
		.animation(.default, value: model.phase)
		.onChange(of: model.settings) { old, _ in
			model.settingsChanged(from: old)
		}
	}
}

private struct PrivacyCover: View {
	var body: some View {
		ZStack {
			Rectangle().fill(.background)
			Image(systemName: "lock.shield.fill")
				.font(.system(size: 64))
				.foregroundStyle(Color.accentColor)
		}
		.ignoresSafeArea()
	}
}

/// Short confirmations ("Password copied") and errors, dismissed after a moment.
private struct BannerView: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		if let text = model.banner {
			Text(text)
				.font(.subheadline.weight(.medium))
				.padding(.horizontal, 16)
				.padding(.vertical, 10)
				.background(.regularMaterial, in: Capsule())
				.padding(.bottom, 24)
				.transition(.move(edge: .bottom).combined(with: .opacity))
				.accessibilityIdentifier("banner")
				.task(id: text) {
					try? await Task.sleep(for: .seconds(2.5))
					if model.banner == text {
						withAnimation { model.banner = nil }
					}
				}
		}
	}
}
