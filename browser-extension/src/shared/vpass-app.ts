/**
 * The V-Pass web app itself (`…/apps/vpass/` on a Nextcloud). The extension
 * stays out of it: no autofill or save prompts (it would offer to store the
 * master password in the vault) and no passkey interception (the app's own
 * passkey unlock needs the browser's PRF support). It only talks to the app
 * through the web-app bridge ("Browser extension" page).
 */
export const VPASS_APP_PATH = /\/apps\/vpass(\/|$)/

export function isVPassApp(pathname: string): boolean {
	return VPASS_APP_PATH.test(pathname)
}
