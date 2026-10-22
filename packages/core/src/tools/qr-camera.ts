import { findQrText } from './qr.ts'

/**
 * Reads QR codes from the computer's camera in a web page (the web app and the
 * extension's import page), for codes shown on another device's screen. Frames
 * are decoded in the page and never stored or sent anywhere.
 */
export class QrCamera {
	private stream: MediaStream | null = null
	private timer: ReturnType<typeof setTimeout> | undefined
	private stopped = false

	static get supported(): boolean {
		return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
	}

	/**
	 * Show the camera in `video` and call `onText` with a QR code's text each
	 * time a different one comes into view. Rejects with the browser's error
	 * (NotAllowedError, NotFoundError, NotReadableError) when there is no camera.
	 */
	async start(video: HTMLVideoElement, onText: (text: string) => void): Promise<void> {
		const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
		if (this.stopped) {
			stream.getTracks().forEach((track) => track.stop())
			return
		}
		this.stream = stream
		video.muted = true
		video.playsInline = true
		video.srcObject = stream
		await video.play()
		const canvas = new OffscreenCanvas(1, 1)
		const ctx = canvas.getContext('2d', { willReadFrequently: true })!
		let last = ''
		const tick = async (): Promise<void> => {
			if (this.stopped) {
				return
			}
			if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
				// Google Authenticator's export codes are dense, so keep up to 1280 pixels of width.
				const scale = Math.min(1, 1280 / video.videoWidth)
				canvas.width = Math.round(video.videoWidth * scale)
				canvas.height = Math.round(video.videoHeight * scale)
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
				const text = await findQrText(ctx.getImageData(0, 0, canvas.width, canvas.height))
				if (text && text !== last && !this.stopped) {
					last = text
					onText(text)
				}
			}
			this.timer = setTimeout(() => void tick(), 200)
		}
		void tick()
	}

	stop(): void {
		this.stopped = true
		clearTimeout(this.timer)
		this.stream?.getTracks().forEach((track) => track.stop())
		this.stream = null
	}
}
