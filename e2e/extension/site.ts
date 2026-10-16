import {
	type AuthenticationResponseJSON,
	type RegistrationResponseJSON,
	type WebAuthnCredential,
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { readFileSync } from 'node:fs'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'

/**
 * A tiny website for the extension tests, on http://localhost:<port> (a secure
 * context, so WebAuthn works). Forms cover login, sign-up, password change,
 * one-time codes, checkout and addresses; the WebAuthn pages use
 * @simplewebauthn/browser, like many real sites, and the server verifies every
 * response with @simplewebauthn/server.
 */

// The UMD bundle is not in the package's "exports"; find it from the package directory.
const SWA_ENTRY = fileURLToPath(import.meta.resolve('@simplewebauthn/browser'))
const SWA_DIR = SWA_ENTRY.slice(0, SWA_ENTRY.indexOf('/@simplewebauthn/browser/') + '/@simplewebauthn/browser/'.length)
const SWA_BUNDLE = readFileSync(`${SWA_DIR}dist/bundle/index.umd.min.js`, 'utf8')

const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;max-width:480px;margin:40px auto}label{display:block;margin:10px 0}input,select{display:block;width:100%;padding:6px;font-size:15px}</style>
</head><body><h1>${title}</h1>${body}</body></html>`

const PAGES: Record<string, string> = {
	'/login': page('Log in', `
<form method="post" action="/welcome">
	<label>Email <input name="email" type="email" autocomplete="username"></label>
	<label>Password <input name="password" type="password"></label>
	<button type="submit">Log in</button>
</form>`),
	'/signup': page('Create account', `
<form method="post" action="/welcome">
	<label>Email <input name="email" type="email"></label>
	<label>Password <input name="password" type="password"></label>
	<label>Repeat password <input name="password2" type="password"></label>
	<button type="submit">Sign up</button>
</form>`),
	'/change': page('Change password', `
<form method="post" action="/welcome">
	<input type="text" name="username" autocomplete="username" value="alice@example.com" hidden>
	<label>Current password <input name="current" type="password"></label>
	<label>New password <input name="new" type="password"></label>
	<label>Confirm new password <input name="confirm" type="password"></label>
	<button type="submit">Change password</button>
</form>`),
	'/otp': page('Two-factor authentication', `
<form method="post" action="/welcome">
	<label>Authentication code <input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label>
	<button type="submit">Verify</button>
</form>`),
	'/checkout': page('Checkout', `
<form onsubmit="return false">
	<label>Name on card <input name="ccname"></label>
	<label>Card number <input name="cardnumber"></label>
	<label>Expiry (MM/YY) <input name="exp" placeholder="MM/YY" maxlength="5"></label>
	<label>CVC <input name="cvc" maxlength="4"></label>
</form>`),
	'/address': page('Shipping address', `
<form onsubmit="return false">
	<label>First name <input name="first_name"></label>
	<label>Last name <input name="last_name"></label>
	<label>Street address <input name="street"></label>
	<label>City <input name="city"></label>
	<label>ZIP code <input name="zip"></label>
	<label>Country <select name="country"><option value="">Choose</option><option value="CA">Canada</option><option value="US">United States</option></select></label>
	<label>Phone <input name="phone" type="tel"></label>
</form>`),
	'/welcome': page('Welcome', '<p id="welcome">You are signed in.</p>'),
	'/webauthn': page('Passkeys', `
<label>Username <input id="username" value="alice@example.com"></label>
<button id="register">Create passkey</button>
<button id="login">Sign in with passkey</button>
<p id="result"></p>
<script src="/swa.js"></script>
<script>
	const { startRegistration, startAuthentication } = SimpleWebAuthnBrowser
	const show = (text) => { document.getElementById('result').textContent = text }
	async function call(path, body) {
		const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
		return res.json()
	}
	document.getElementById('register').onclick = async () => {
		try {
			const optionsJSON = await call('/webauthn/register/options', { username: document.getElementById('username').value })
			const response = await startRegistration({ optionsJSON })
			const result = await call('/webauthn/register/verify', response)
			show(result.verified ? 'registered' : 'registration failed: ' + result.error)
		} catch (e) { show('error: ' + e.name + ': ' + e.message) }
	}
	document.getElementById('login').onclick = async () => {
		try {
			const optionsJSON = await call('/webauthn/login/options')
			const response = await startAuthentication({ optionsJSON })
			const result = await call('/webauthn/login/verify', response)
			show(result.verified ? 'signed in as ' + result.username : 'sign-in failed: ' + result.error)
		} catch (e) { show('error: ' + e.name + ': ' + e.message) }
	}
</script>`),
	'/webauthn-autofill': page('Passkey autofill', `
<form onsubmit="return false">
	<label>Username <input id="username" name="username" autocomplete="username webauthn"></label>
	<label>Password <input name="password" type="password" autocomplete="current-password"></label>
</form>
<p id="result"></p>
<script src="/swa.js"></script>
<script>
	const { startAuthentication, browserSupportsWebAuthnAutofill } = SimpleWebAuthnBrowser
	const show = (text) => { document.getElementById('result').textContent = text }
	;(async () => {
		if (!(await browserSupportsWebAuthnAutofill())) { show('no autofill support'); return }
		const optionsJSON = await (await fetch('/webauthn/login/options', { method: 'POST' })).json()
		try {
			const response = await startAuthentication({ optionsJSON, useBrowserAutofill: true })
			const result = await (await fetch('/webauthn/login/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(response) })).json()
			show(result.verified ? 'signed in as ' + result.username : 'sign-in failed: ' + result.error)
		} catch (e) { show('error: ' + e.name + ': ' + e.message) }
	})()
</script>`),
}

export interface TestSite {
	origin: string
	/** Credentials the server registered (from verified registrations). */
	credentials: { username: string, credential: WebAuthnCredential }[]
	/** Form posts received on /welcome. */
	submissions: Record<string, string>[]
	close: () => Promise<void>
}

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = []
	for await (const chunk of req) chunks.push(chunk as Buffer)
	return Buffer.concat(chunks).toString('utf8')
}

export async function startTestSite(): Promise<TestSite> {
	let origin = ''
	const rpID = 'localhost'
	const site: TestSite = { origin: '', credentials: [], submissions: [], close: async () => {} }
	let challenge = ''
	let pendingUser = ''

	const json = (res: ServerResponse, body: unknown) => {
		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify(body))
	}

	const server = createServer(async (req, res) => {
		const path = new URL(req.url ?? '/', origin).pathname
		try {
			if (path === '/swa.js') {
				res.writeHead(200, { 'Content-Type': 'text/javascript' })
				res.end(SWA_BUNDLE)
			} else if (path === '/webauthn/register/options') {
				const { username } = JSON.parse(await readBody(req) || '{}') as { username: string }
				pendingUser = username
				const options = await generateRegistrationOptions({
					rpName: 'V-Pass Test Site',
					rpID,
					userName: username,
					attestationType: 'none',
					excludeCredentials: site.credentials.filter((c) => c.username === username).map((c) => ({ id: c.credential.id })),
					authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
				})
				challenge = options.challenge
				json(res, options)
			} else if (path === '/webauthn/register/verify') {
				const response = JSON.parse(await readBody(req)) as RegistrationResponseJSON
				try {
					const result = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true })
					if (result.verified) site.credentials.push({ username: pendingUser, credential: result.registrationInfo.credential })
					json(res, { verified: result.verified })
				} catch (e) {
					json(res, { verified: false, error: (e as Error).message })
				}
			} else if (path === '/webauthn/login/options') {
				await readBody(req)
				const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' })
				challenge = options.challenge
				json(res, options)
			} else if (path === '/webauthn/login/verify') {
				const response = JSON.parse(await readBody(req)) as AuthenticationResponseJSON
				const known = site.credentials.find((c) => c.credential.id === response.id)
				if (!known) {
					json(res, { verified: false, error: 'unknown credential' })
					return
				}
				try {
					const result = await verifyAuthenticationResponse({ response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, credential: known.credential, requireUserVerification: true })
					json(res, { verified: result.verified, username: known.username })
				} catch (e) {
					json(res, { verified: false, error: (e as Error).message })
				}
			} else if (PAGES[path]) {
				if (req.method === 'POST' && path === '/welcome') {
					site.submissions.push(Object.fromEntries(new URLSearchParams(await readBody(req))))
				}
				res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
				res.end(PAGES[path])
			} else {
				res.writeHead(404)
				res.end('not found')
			}
		} catch (e) {
			res.writeHead(500)
			res.end(String(e))
		}
	})
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve))
	origin = `http://localhost:${(server.address() as AddressInfo).port}`
	site.origin = origin
	site.close = () => new Promise((resolve) => server.close(() => resolve()))
	return site
}
