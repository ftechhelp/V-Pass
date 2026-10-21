import Foundation
#if canImport(CoreImage)
import CoreImage
#endif

/// Authenticator setup QR codes (otpauth://totp/…), as `tools/qr.ts`.

/// The first QR code text that is an authenticator key, as encoded. Other QR
/// codes on the screen or in the picture (a website link, an app download) are skipped.
public func firstTotp(in payloads: [String]) -> String? {
	payloads.first { (try? parseTotp($0)) != nil }
}

#if canImport(CoreImage)
/// The text of every QR code in an image (a screenshot or a photo), read on the device.
public func qrPayloads(inImageData data: Data) -> [String] {
	guard let image = CIImage(data: data),
	      let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])
	else {
		return []
	}
	return detector.features(in: image).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
}
#endif
