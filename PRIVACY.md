# V-Pass privacy policy

*Effective 16 October 2026. Applies to the V-Pass browser extension and the V-Pass app for Nextcloud.*

V-Pass is a free, open-source password manager. It runs on a Nextcloud server that you or your organization operate. The developer of V-Pass runs **no servers** and **receives no data** from you: no account, no analytics, no telemetry, no crash reports and no advertising.

## What V-Pass handles

- **Your vault:** logins (usernames, passwords, website addresses, one-time-code secrets, passkeys), secure notes, payment cards, personal information (names, addresses, email addresses, phone numbers) and file attachments.
- **Your master password**, which unlocks the vault.
- **The connection to your Nextcloud:** its address, your Nextcloud login name, and an app password that Nextcloud issues to the extension when you choose "Grant access".
- **Your preferences**, such as auto-lock time and generator settings.

## Where it goes

- **Your vault is end-to-end encrypted.**
  - It is encrypted and decrypted only on your device (Argon2id and XChaCha20-Poly1305, using libsodium).
  - The encrypted copy is stored on, and synced through, **the Nextcloud server you connect to, and no other server**.
  - Neither that server nor the developer can read it.
- **Your master password never leaves your device.** It is not sent anywhere or stored. The one exception is described under "Keep unlocked" below.
- **The app password is sent only to your Nextcloud server,** to authenticate the extension's requests. You can revoke it at any time in Nextcloud under *Settings → Security*, or by choosing *Disconnect* in the extension.
- **Nothing is sold or shared** with third parties, and nothing is used for advertising, creditworthiness or any purpose other than providing the password manager.

## What the extension does on websites

- **Finding fields:** to find login, one-time-code, payment and address fields, the extension examines the forms on the pages you visit. This happens on your device. Page content and your browsing history are **not** collected or sent anywhere.
- **Matching logins:** the address of the current page is compared with your saved logins on your device, to decide which logins to suggest.
- **Filling and saving:**
  - Values are filled into a page only when you choose to fill them.
  - When you sign in, change a password or sign up, the extension reads the username and password you submitted, so it can offer to save or update them.
  - They are stored only if you click *Save* or *Update*, and then only encrypted, in your vault.
- **Passkeys:** when a website asks to create or use a passkey, the extension offers to answer from your vault. It answers only after you confirm, and you can always hand the request back to the browser instead.

## What is stored in your browser

- **The connection and preferences:** your Nextcloud address, login name, app password and preferences are kept in the extension's local storage.
- **An encrypted copy of your vault** is kept locally, the same ciphertext that is on the server, so filling works offline.
- **The key that unlocks your vault:**
  - **Default:** while the vault is unlocked, the key is kept only in memory and in the browser's session storage. Chrome clears both when it closes.
  - **"Keep unlocked on this device":** if you turn this option on, the key is also stored in the extension's local storage until you lock the vault. Anyone with access to your computer account or browser profile could then open the vault, and V-Pass warns you about this before you turn it on.

Disconnecting the extension deletes the app password and the local copy of the vault from your browser. Removing the extension deletes everything it stored.

## The Nextcloud app

The V-Pass app stores your encrypted vault in your Nextcloud's database and app-data folder. Your Nextcloud administrator controls that server, its backups and its logs, but cannot decrypt your vault.

If the administrator enables the breach check, the web app checks passwords against Have I Been Pwned **through your Nextcloud server**. It uses k-anonymity: only the first 5 characters of the password's SHA-1 hash are sent, never the password itself. The browser extension does not do breach checks.

## Children

V-Pass is not directed at children and collects no data from anyone.

## Changes and contact

Changes to this policy are published in this file, with a new effective date. The full history is in the repository: <https://github.com/ftechhelp/V-Pass/commits/main/PRIVACY.md>.

Questions: open an issue at <https://github.com/ftechhelp/V-Pass/issues>.
