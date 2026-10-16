// Rebuild every part of the extension on change (npm run dev), then reload it in chrome://extensions.
import { spawn } from 'node:child_process'

for (const mode of ['pages', 'background', 'content', 'main-world']) {
	spawn('npx', ['vite', 'build', '--watch', '--mode', mode], { stdio: 'inherit', shell: process.platform === 'win32' })
}
