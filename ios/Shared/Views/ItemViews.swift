import SwiftUI
import VPassKit

/// The coloured type badge used in lists.
struct ItemIcon: View {
	let item: Item
	var size: CGFloat = 32

	private var symbol: String {
		switch item.type {
		case .login: item.passkeys.isEmpty ? "key.fill" : "person.badge.key.fill"
		case .note: "note.text"
		case .card: "creditcard.fill"
		case .identity: "person.text.rectangle.fill"
		}
	}

	private var color: Color {
		switch item.type {
		case .login: .blue
		case .note: .orange
		case .card: .green
		case .identity: .purple
		}
	}

	var body: some View {
		Image(systemName: symbol)
			.font(.system(size: size * 0.5, weight: .semibold))
			.foregroundStyle(.white)
			.frame(width: size, height: size)
			.background(color.gradient, in: RoundedRectangle(cornerRadius: size * 0.25, style: .continuous))
			.accessibilityHidden(true)
	}
}

struct ItemRow: View {
	let item: Item
	var trailing: String?

	var body: some View {
		HStack(spacing: 12) {
			ItemIcon(item: item)
			VStack(alignment: .leading, spacing: 2) {
				Text(itemDisplayTitle(item))
					.font(.body)
					.lineLimit(1)
				let subtitle = itemSubtitle(item)
				if !subtitle.isEmpty {
					Text(subtitle)
						.font(.subheadline)
						.foregroundStyle(.secondary)
						.lineLimit(1)
				}
			}
			Spacer(minLength: 0)
			if item.favorite {
				Image(systemName: "star.fill")
					.font(.caption)
					.foregroundStyle(.yellow)
					.accessibilityLabel("Favorite")
			}
			if let trailing {
				Text(trailing)
					.font(.caption)
					.foregroundStyle(.secondary)
			}
		}
		.contentShape(Rectangle())
	}
}

/// A live TOTP code with a countdown ring.
struct TotpCodeView: View {
	let secret: String
	var onCopy: ((String) -> Void)?

	var body: some View {
		if let params = try? parseTotp(secret) {
			TimelineView(.periodic(from: .now, by: 1)) { context in
				let code = totpCode(params, now: context.date)
				HStack {
					Text(formatTotpCode(code.code))
						.font(.system(.title2, design: .monospaced).weight(.semibold))
						.accessibilityIdentifier("totp-code")
					Spacer()
					ZStack {
						Circle().stroke(.quaternary, lineWidth: 3)
						Circle()
							.trim(from: 0, to: CGFloat(code.remaining) / CGFloat(code.period))
							.stroke(code.remaining <= 5 ? Color.red : Color.accentColor, style: StrokeStyle(lineWidth: 3, lineCap: .round))
							.rotationEffect(.degrees(-90))
						Text("\(code.remaining)")
							.font(.caption2.monospacedDigit())
					}
					.frame(width: 28, height: 28)
					.accessibilityLabel("\(code.remaining) seconds left")
					if let onCopy {
						Button {
							onCopy(code.code)
						} label: {
							Image(systemName: "doc.on.doc")
						}
						.buttonStyle(.borderless)
						.accessibilityLabel("Copy code")
					}
				}
			}
		} else {
			Label("Not a valid authenticator key", systemImage: "exclamationmark.triangle")
				.foregroundStyle(.secondary)
		}
	}
}
