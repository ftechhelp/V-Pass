# Chrome Web Store submission

Everything to paste into the [developer dashboard](https://chrome.google.com/webstore/devconsole), tab by tab. Images are in [`images/`](images); regenerate them with `make store-images` (needs `make dev-up`).

## Package

Every upload needs a **higher `version`** in `browser-extension/public/manifest.json` than the previous one.

**Automatic uploads.** [`.github/workflows/extension.yml`](../../.github/workflows/extension.yml) runs the extension's unit and end-to-end tests on every push that touches it. On `main`, when the manifest's version is newer than what the store has, it uploads the tested zip and submits it for review; Chrome publishes it once the review passes, keeping the listing's visibility (unlisted).
- An older version still waiting for review is cancelled and replaced by the newer one.
- Re-runs, and pushes that don't change the version, upload nothing.
- From another branch: *Actions → Chrome extension → Run workflow*, with *Upload this commit* ticked.
- The API only updates this existing item. Listing text, images and privacy answers stay in the dashboard. After changing the visibility in the dashboard, publish once by hand before the API can publish again.

**One-time setup** (until then the upload job is skipped):
1. In the [Google Cloud console](https://console.cloud.google.com/), create a project (or reuse one) and enable the **Chrome Web Store API** under *APIs & Services → Library*.
2. *IAM & Admin → Service accounts → Create service account*, for example `vpass-web-store`. It needs no roles. Open it, then *Keys → Add key → Create new key → JSON*. (If Google refuses to create a key, an organization policy blocks service account keys.)
3. In the Developer Dashboard, add the service account's email under *Account*. A publisher can have only one.
4. Copy the **Publisher ID** from the Developer Dashboard (*Publisher → Settings*).
5. Store both as GitHub Actions secrets, then delete the downloaded key:
   ```bash
   gh secret set CWS_SERVICE_ACCOUNT_KEY < ~/Downloads/<the key>.json
   gh secret set CWS_PUBLISHER_ID --body '<publisher id>'
   ```
6. Check that it works before deleting the key: `CWS_SERVICE_ACCOUNT_KEY="$(cat <the key>.json)" CWS_PUBLISHER_ID=<publisher id> node browser-extension/scripts/web-store.ts status` prints the published and submitted versions.

**By hand:** upload `build/vpass-extension-<version>.zip`, made by `make extension-zip`, under *Package → Upload new package*, then submit it for review.

## Store listing tab

| Field | Value |
|---|---|
| Title | V-Pass (taken from the manifest) |
| Summary | Autofill, save prompts and passkeys for your end-to-end encrypted V-Pass vault on Nextcloud. (taken from the manifest) |
| Category | Productivity → Tools, or Privacy & Security if the dashboard offers it |
| Language | English |
| Store icon | `images/store-icon-128.png` |
| Screenshots (in this order) | `screenshot-1-autofill.png`, `screenshot-2-popup.png`, `screenshot-3-passkeys.png`, `screenshot-4-save.png`, `screenshot-5-vault.png` |
| Small promo tile | `images/promo-small-440x280.png` |
| Homepage URL | https://github.com/ftechhelp/V-Pass |
| Support URL | https://github.com/ftechhelp/V-Pass/issues |
| Mature content | No |

**Description:**

```
V-Pass is a zero-knowledge password manager that runs on your own Nextcloud. This extension connects Chrome to your V-Pass vault so you can:

• Fill logins from a menu in the field, the toolbar button or Ctrl+Shift+L, only on the sites they are saved for
• Save new logins and update changed passwords as you sign in
• Generate strong passwords and passphrases
• Fill two-factor (TOTP) codes, payment cards and addresses
• Set up two-factor codes by scanning the QR code a site shows, right from the toolbar button
• Create and use passkeys stored in your vault, on any computer, or hand the request to your phone or security key

Your vault stays yours
Everything is encrypted and decrypted on your device with your master password (Argon2id and XChaCha20-Poly1305). Your Nextcloud stores only ciphertext. The developer runs no servers and collects nothing.

Getting started
1. Install the V-Pass app on your Nextcloud (35) and create your vault in it.
2. Add this extension, then open V-Pass on your Nextcloud → Browser extension → Connect this browser.
3. Unlock with your master password.

V-Pass is free and open source: https://github.com/ftechhelp/V-Pass
```

## Privacy practices tab

**Single purpose:**

```
Password manager: fills, saves and generates logins, and creates and uses passkeys, from the user's own end-to-end encrypted V-Pass vault on their Nextcloud server.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Stores the connection to the user's Nextcloud, preferences, and an encrypted copy of the vault (so filling works offline). While unlocked, the vault key is kept in session storage, which Chrome clears when it closes. |
| `unlimitedStorage` | The encrypted copy of a large vault can exceed the default storage quota. |
| `alarms` | Periodic sync with the user's Nextcloud, finishing the Nextcloud sign-in, and clearing copied passwords from the clipboard after the configured delay. |
| `idle` | Auto-lock: locks the vault after the computer has been idle, or when it is locked. |
| `contextMenus` | Adds "Fill login" and "Generate password" to the right-click menu of editable fields. |
| `offscreen` | The service worker has no DOM, so a small offscreen document writes to the clipboard (generated passwords) and clears copied secrets after the configured delay. |
| `scripting` | When the extension is installed or updated, adds its content scripts to tabs that are already open, so filling works there without a reload. It is not used for anything else. |

**Host permission justification** (its own field; it covers `<all_urls>` and the content scripts' `http://*/*` and `https://*/*` matches):

```
V-Pass is a password manager, so it has to work on whichever sites the user signs in to. Those sites cannot be known in advance.

Content scripts (http://*/* and https://*/*):
- find login, one-time-code, payment card and address fields, so the user can choose what to fill (nothing is filled without a user action);
- notice submitted logins, so V-Pass can offer to save or update them;
- answer a site's passkey (WebAuthn) requests from the vault, only after the user confirms in a V-Pass window.
All of this runs on the device. Page content and browsing history are never collected or sent anywhere.

<all_urls>:
- lets the extension sync the end-to-end encrypted vault with the user's own Nextcloud server, whose address is only known once the user enters it;
- lets it add its content scripts to tabs that were already open when it was installed or updated;
- lets it capture the visible part of the current tab, only when the user clicks "Scan QR code", to read a two-factor (2FA) setup QR code on the device. The image is discarded straight away and never stored or sent.
```

**Remote code:** "No, I am not using remote code." All code ships in the package. The bundled libsodium WebAssembly runs under MV3's `wasm-unsafe-eval`; `eval` and remote scripts are not used.

**Data usage:**
- Tick:
  - **Personally identifiable information** (names, addresses, emails in personal-info items);
  - **Financial and payment information** (saved cards);
  - **Authentication information** (passwords, passkeys, one-time-code secrets).
- Explain that the extension stores these end-to-end encrypted in the user's own vault, synced only to the user's own Nextcloud server.
- Leave everything else unticked: no browsing history, page content, location, communications or user activity is collected.
- Tick all three certifications (not sold to third parties; not used for unrelated purposes; not used for creditworthiness or lending).

**Privacy policy URL:** https://github.com/ftechhelp/V-Pass/blob/main/PRIVACY.md

## Distribution tab

- **Payment:** Free.
- **Visibility:** **Unlisted.** Anyone with the link can install it, but it doesn't appear in search.
- **Regions:** All regions.

## Test instructions tab

Reviewers need a Nextcloud with V-Pass and a vault to try the extension. Fill in the reviewer account (see the README's "Chrome Web Store" section):

```
V-Pass needs a Nextcloud server with the V-Pass app. Test account:

1. Install the extension and click its toolbar icon.
2. Nextcloud address: <server>  → Connect → sign in with <reviewer user> / <reviewer password> → Grant access.
3. Master password: <reviewer master password>
4. Visit any site's login page and click into the username field: the vault's logins appear in the V-Pass menu. https://webauthn.io can be used to try passkeys.
```

## After approval

The listing went live on 2026-10-18: <https://chromewebstore.google.com/detail/v-pass/fnbnjjalcjpopkiobdkaaffdiccolbfl> (extension id `fnbnjjalcjpopkiobdkaaffdiccolbfl`).

1. Done: `CHROME_WEB_STORE_URL` in `nextcloud-app/src/services/extension.ts` holds the link, so the web app's "Browser extension" page shows "Add to Chrome". If the listing ever moves, update it there, in the UI test (`e2e/ui/vault.spec.ts`) and in the README.
2. Updates: bump the manifest version, run `make extension-zip`, and upload the zip under **Package → Upload new package**. Then submit for review.
