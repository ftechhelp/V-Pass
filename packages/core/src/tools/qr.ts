import { parseTotp } from './totp.ts'

/** Reading authenticator setup QR codes (otpauth://totp/…) from images, on the device. */

export class NoQrCodeError extends Error {
	constructor(message = 'No QR code found') {
		super(message)
		this.name = 'NoQrCodeError'
	}
}

/** RGBA pixels, as in `ImageData`. */
export interface QrImage {
	data: Uint8ClampedArray
	width: number
	height: number
}

/**
 * Find a QR code in the image and return its text if it is an authenticator
 * key. Throws NoQrCodeError without a QR code, InvalidTotpError for any other
 * QR code. jsQR is loaded on first use, so bundles that never scan don't carry it.
 */
export async function readTotpQr(image: QrImage): Promise<string> {
	const { default: jsQR } = await import('jsqr')
	const result = jsQR(image.data, image.width, image.height)
	if (!result?.data) {
		throw new NoQrCodeError()
	}
	parseTotp(result.data)
	return result.data
}
