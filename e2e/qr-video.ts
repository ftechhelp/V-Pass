import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import QRCode from 'qrcode'

/**
 * A fake camera for Chromium: a Y4M video of one QR code, for
 * `--use-file-for-fake-video-capture`, so the camera import runs headless.
 * Returns the launch flags.
 */
export function fakeCameraShowing(text: string): string[] {
	const width = 640
	const height = 480
	const { modules } = QRCode.create(text, { errorCorrectionLevel: 'L' })
	const scale = Math.floor(Math.min(width, height) / (modules.size + 8))
	const left = Math.floor((width - modules.size * scale) / 2)
	const top = Math.floor((height - modules.size * scale) / 2)
	// 4:2:0 frame: full-size brightness, then two quarter-size colour planes (128 = grey).
	const luma = Buffer.alloc(width * height, 235)
	for (let row = 0; row < modules.size; row++) {
		for (let col = 0; col < modules.size; col++) {
			if (!modules.get(row, col)) continue
			for (let y = 0; y < scale; y++) {
				luma.fill(16, (top + row * scale + y) * width + left + col * scale, (top + row * scale + y) * width + left + (col + 1) * scale)
			}
		}
	}
	const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, Buffer.alloc(width * height / 2, 128)])
	const file = join(mkdtempSync(join(tmpdir(), 'vpass-camera-')), 'qr.y4m')
	writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`), frame, frame]))
	return ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${file}`]
}
