// Package browser-extension/dist (run `npm run build` first):
// - build/vpass-extension-<version>.zip: upload this to the Chrome Web Store
// - nextcloud-app/extension/: the same zip plus its version, offered for
//   download on the web app's "Browser extension" page
// Source maps stay out of the zip; the code itself is not minified.
import { zipSync } from 'fflate'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const dist = join(root, 'browser-extension', 'dist')
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))

const files = {}
function collect(dir) {
	for (const name of readdirSync(dir).sort()) {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) {
			collect(path)
		} else if (!name.endsWith('.map')) {
			files[relative(dist, path).split(sep).join('/')] = readFileSync(path)
		}
	}
}
collect(dist)

// Fixed timestamps keep the zip identical for identical code.
const zip = zipSync(files, { level: 9, mtime: new Date('2026-01-01T00:00:00Z') })

const storeZip = join(root, 'build', `vpass-extension-${manifest.version}.zip`)
mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(storeZip, zip)

const appDir = join(root, 'nextcloud-app', 'extension')
mkdirSync(appDir, { recursive: true })
writeFileSync(join(appDir, 'vpass-extension.zip'), zip)
writeFileSync(join(appDir, 'extension.json'), `${JSON.stringify({ version: manifest.version })}\n`)

console.log(`V-Pass extension ${manifest.version}: ${Object.keys(files).length} files, ${(zip.length / 1024).toFixed(0)} KiB`)
console.log(`  Chrome Web Store upload: ${relative(root, storeZip)}`)
console.log(`  Web app download:        ${relative(root, join(appDir, 'vpass-extension.zip'))}`)
