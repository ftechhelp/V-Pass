import { isGoogleAuthenticatorExport } from '../import/authenticator.ts'
import { InvalidTotpError, parseTotp } from './totp.ts'

/** Reading authenticator setup QR codes (otpauth://totp/…) from images, on the device. */

export class NoQrCodeError extends Error {
	constructor(message = 'No QR code found') {
		super(message)
		this.name = 'NoQrCodeError'
	}
}

/** A Google Authenticator export code was scanned where a single 2FA setup code was expected. */
export class ExportQrCodeError extends InvalidTotpError {
	constructor(message = 'This is a Google Authenticator export code. Use "Import 2FA codes" for it.') {
		super(message)
		this.name = 'ExportQrCodeError'
	}
}

/** RGBA pixels, as in `ImageData`. */
export interface QrImage {
	data: Uint8ClampedArray
	width: number
	height: number
}

/** The text of the QR code in the image, or null. jsQR is loaded on first use, so bundles that never scan don't carry it. */
export async function findQrText(image: QrImage): Promise<string | null> {
	const { default: jsQR } = await import('jsqr')
	return jsQR(image.data, image.width, image.height)?.data || null
}

/** The text of the QR code in the image, whatever it holds. Throws NoQrCodeError. */
export async function readQrText(image: QrImage): Promise<string> {
	const text = await findQrText(image)
	if (!text) {
		throw new NoQrCodeError()
	}
	return text
}

/**
 * Find a QR code in the image and return its text if it is an authenticator
 * key. Throws NoQrCodeError without a QR code, ExportQrCodeError for a Google
 * Authenticator export, InvalidTotpError for any other QR code.
 */
export async function readTotpQr(image: QrImage): Promise<string> {
	const text = await readQrText(image)
	if (isGoogleAuthenticatorExport(text)) {
		throw new ExportQrCodeError()
	}
	parseTotp(text)
	return text
}

/**
 * The text of the QR code in a picture (a screenshot or a photo), decoded in
 * this browser. Large pictures are slow to search (seconds at 4K), so they
 * are looked at `width` pixels wide first, then at full size if nothing was
 * found there. Throws NoQrCodeError.
 */
export async function readQrTextFromImage(image: Blob, width = 1200): Promise<string> {
	const full = await createImageBitmap(image)
	try {
		if (width < full.width) {
			const small = await createImageBitmap(image, { resizeWidth: width, resizeQuality: 'high' })
			const text = await findQrText(pixels(small))
			small.close()
			if (text) {
				return text
			}
		}
		return await readQrText(pixels(full))
	} finally {
		full.close()
	}
}

function pixels(bitmap: ImageBitmap): ImageData {
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
	const ctx = canvas.getContext('2d')!
	ctx.drawImage(bitmap, 0, 0)
	return ctx.getImageData(0, 0, canvas.width, canvas.height)
}
