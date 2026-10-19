# V-Pass

A zero-knowledge password manager that runs as an app inside your own Nextcloud. It is modelled on NordPass.

- **Item types:** passwords, passkeys, secure notes, credit cards and personal info, organized in folders, with favorites and a trash.
- **Unlocking:** a master password or a passkey (WebAuthn PRF). A recovery key covers a forgotten master password.
- **Tools:**
  - a password and passphrase generator
  - password health (weak, reused and old passwords)
  - a breach check against Have I Been Pwned, using k-anonymity
  - built-in 2FA (TOTP) codes
  - encrypted file attachments
- **Import and export:** import from NordPass. Export to an encrypted `.vpass` backup or to CSV.
- **Chrome extension:** fills logins, one-time codes, cards and addresses; offers to save new logins and changed passwords; generates passwords; and stores and uses website passkeys from the vault.
- **iPhone app:** browse, search, copy and edit the vault, unlock with Face ID, and fill passwords, 2FA codes and passkeys in Safari and other apps through iOS AutoFill.

## Security model

Everything is encrypted and decrypted **in the browser**. The Nextcloud server stores only ciphertext. Your administrator, a database dump or a stolen server backup cannot read your vault.

```
master password ──Argon2id (64 MiB, t=3)──▶ master key ──KDF──▶ KEK ─wraps─▶ Vault Key (VK)
recovery key (256-bit, shown once) ──────────────────KDF──▶ RK  ─wraps─▶ VK
passkey PRF output (WebAuthn) ───────────────────────KDF──▶ PK  ─wraps─▶ VK
VK ─wraps─▶ per-item key ─XChaCha20-Poly1305─▶ item JSON (type, title, folder, fields…)
                         └─wraps─▶ per-file key ─secretstream─▶ attachment (name + content)
```

- **Crypto library:** libsodium (WebAssembly). The page CSP allows only `wasm-unsafe-eval`; JavaScript `eval` stays blocked.
- **Binding ciphertext to its object:** every ciphertext is tied to its object ID through AEAD associated data. The server cannot swap one item's ciphertext for another without detection.
- **Visible metadata:** the server sees only IDs, revision numbers, timestamps, whether an item is in the trash, and attachment sizes. Item type, title, URLs and folder names are encrypted.
- **Key handling in the browser:**
  - Keys live only in memory. A page reload locks the vault, and so does the configurable inactivity timer.
  - Copied secrets are cleared from the clipboard after 30 seconds by default.
- **Changing the master password** re-wraps the VK only. Items are not re-encrypted.
- **Passkeys:** the per-item key design leaves room for sharing between users later; each user would get an X25519 key pair.

**Known limits:**
- **The web app trusts the JavaScript that your server sends.** A compromised server could ship modified code. This is the same trade-off as any web vault, Bitwarden's included. The Chrome extension ships its own code, so it does not have this problem.
- **Signing in to websites with a stored passkey needs the Chrome extension or the iPhone app.** A web page cannot answer another site's passkey prompt.
- **HTTPS is required.** Browsers disable WebCrypto and WebAuthn on plain HTTP.

## Repository layout

| Path | What |
|---|---|
| `packages/core` | `@vpass/core`: crypto, item schemas, NordPass importer, exporters, generator, TOTP, HIBP, health, typed API client. Framework-free, so the browser extension and desktop client can reuse it. |
| `nextcloud-app` | The Nextcloud app (`appinfo/`, `lib/` PHP, `src/` Vue 3 UI, `templates/`). Installed as `custom_apps/vpass`. |
| `browser-extension` | The Chrome extension (Manifest V3, Vue 3). Built into `browser-extension/dist`, which you load unpacked. |
| `ios` | The iPhone app and its AutoFill extension (SwiftUI), plus `VPassKit`, a Swift port of `@vpass/core` that also builds and tests on Linux. |
| `e2e` | API integration tests (vitest), browser tests (Playwright), the extension's end-to-end tests and the zero-knowledge check. |
| `dev` | Docker Compose setup for a local Nextcloud 35 with Postgres and Redis. |

## Install on your Nextcloud (35)

```bash
make install        # first time only: npm + composer (composer runs in Docker)
make appstore       # → build/vpass-0.1.0.tar.gz
```

Copy the archive to the server, then run:

```bash
tar -xzf vpass-0.1.0.tar.gz -C /var/www/nextcloud/custom_apps/
sudo -u www-data php occ app:enable vpass
```

**Check your PHP upload limits.** `upload_max_filesize` and `post_max_size` must be at least as large as the attachment limit, which defaults to 50 MB. You can change that limit, the HIBP toggle and trash retention under *Administration settings → Security → V-Pass*.

## Chrome extension

The extension uses the vault you created in the V-Pass web app. It talks to the same API with its own app password, and it decrypts everything locally with your master password.

**Install** (Chrome, or another Chromium browser such as Edge or Brave):

1. In V-Pass on your Nextcloud, open **Browser extension** in the navigation.
2. Click **Add to Chrome**. It opens V-Pass in the [Chrome Web Store](https://chromewebstore.google.com/detail/v-pass/fnbnjjalcjpopkiobdkaaffdiccolbfl), and Chrome then keeps it up to date. The listing is unlisted, so searching the store won't find it; use this link.
   - Without the Web Store: choose **Install it by hand instead** on that page, download the zip, unzip it, and load it with **Developer mode → Load unpacked** in `chrome://extensions`. A copy installed this way doesn't update itself.
3. Back on that page, click **Connect this browser**, confirm in the V-Pass window, and choose **Grant access** on the Nextcloud page that opens.
4. Unlock with your master password from the V-Pass toolbar icon.

You can also connect from the toolbar icon by typing your Nextcloud address.

**For development:** `make extension` builds `browser-extension/dist`, which you can load unpacked directly; `npm run dev:extension` rebuilds it on change. `make extension-zip` makes the Chrome Web Store upload, `build/vpass-extension-<version>.zip`. Everything Google asks for (listing text, permission justifications, privacy answers, screenshots) is in [`browser-extension/store/`](browser-extension/store/LISTING.md), and the privacy policy is [`PRIVACY.md`](PRIVACY.md).

**What it does:**
- **Filling:** a V-Pass icon and menu appear in login, one-time-code, card and address fields. Logins also fill from the toolbar popup or with **Ctrl+Shift+L**. Logins only fill on the sites they are saved for. The extension asks before filling over plain http, or before sending card data to a frame from another site.
- **Saving:** after you sign in, change a password or sign up, a bar offers to save the login or update the stored password. The old password stays in the item's history.
- **Generator:** "Generate password" appears in the menu on sign-up and change-password fields, and in the popup. **Ctrl+Shift+9** fills the focused field, or copies the password if no field is focused.
- **Passkeys:** when a site creates a passkey, V-Pass offers to save it in the vault, either to a matching login or to a new one. Signing in uses it from a small V-Pass window, or from the field menu on sites that offer passkey autofill. **Use another device or security key** always hands the request back to Chrome, so your phone, security keys and Google Password Manager keep working. Saved passkeys also show up under *Passkeys* in the web app.

**Locking:**
- By default the vault locks when Chrome closes, after 15 minutes of computer inactivity, and when the computer locks. You can change these times in the extension's settings.
- **Keep unlocked on this device** (a checkbox on the unlock screen, off by default) keeps the vault unlocked across restarts until you lock it. It stores the vault key in the Chrome profile, so anyone who can use your computer account or copy the profile can open the vault. Only use it on a device that only you use.

**What the extension stores:**

| Data | Where |
|---|---|
| Nextcloud address and the extension's app password | `chrome.storage.local`. Revoke it in Nextcloud under *Settings → Security*, or click *Disconnect*. |
| Your vault | Ciphertext only, as on the server, in `chrome.storage.local`. This lets filling work offline. |
| The vault key | In memory and `chrome.storage.session`, which Chrome clears when it closes. It is also stored in `chrome.storage.local` while "Keep unlocked" is on. |

**On the V-Pass web app itself,** the extension doesn't fill, save or handle passkeys, so it never offers to store your master password. It only answers the "Browser extension" page.

**Protections on web pages:**
- The field menu and the save bar are extension iframes inside a closed shadow root, so pages cannot read them.
- They ignore clicks unless Chrome confirms they are fully visible, which defeats invisible-overlay clickjacking.
- Websites never get to choose which origin a request counts as.

## iPhone app

The app uses the vault you created in the V-Pass web app, like the Chrome extension: it connects with its own app password (Login Flow v2) and decrypts everything on the phone.

**Install:** it is distributed through **TestFlight** under the owner's Apple developer account. Builds come from GitHub Actions (macOS runners), so no Mac is involved; the one-time Apple setup is in [`ios/SETUP.md`](ios/SETUP.md). TestFlight builds expire after 90 days, and every push that changes the app uploads a fresh one.

**What it does:**
- **The app:** connect to your Nextcloud, unlock with the master password (or the recovery key), browse folders and categories, search, copy fields, see live 2FA codes, and add or edit logins, notes, cards and personal info with the password generator. Attachments, password health, import and export stay in the web app.
- **AutoFill** (turn it on in *Settings → General → AutoFill & Passwords → V-Pass*): logins in the keyboard bar and the Passwords sheet, 2FA codes in code fields, and passkeys: signing in with passkeys from the vault (including ones the Chrome extension saved) and saving new ones. A new passkey is saved to Nextcloud before the site gets it.

**Locking:**
- The app locks when it has been in the background for the chosen time (5 minutes by default, or straight away), and whenever iOS closes it.
- **Unlock with Face ID** (off by default) keeps the vault key in the iPhone's Keychain behind Face ID. It is never synced or backed up, and iOS deletes it when the enrolled faces change. AutoFill unlocks the same way; with Face ID off, AutoFill asks for the master password.

**What the app stores:**

| Data | Where |
|---|---|
| Nextcloud address and the app's app password | The iPhone's Keychain, this device only. Revoke it in Nextcloud under *Settings → Security*, or tap *Disconnect this iPhone*. |
| Your vault | Ciphertext only, as on the server, in the app's shared container, readable only while the iPhone is unlocked. AutoFill and offline use read it. |
| The vault key | In memory while unlocked. With Face ID on, also in the Keychain behind Face ID. |
| AutoFill suggestions | With *Suggestions in the keyboard bar* on (the default), iOS keeps the websites, usernames and passkey ids of your logins on the phone so it can suggest them. Never passwords. Turn it off in the app's settings. |

Copies are kept off Universal Clipboard and expire after the clipboard-clear time (one minute by default).

## Development

Requires Node 22+ and Docker.

```bash
make install
make dev-up        # Nextcloud 35 on http://localhost:8080, app enabled, users alice/bob created
make dev           # rebuild the UI on change (reload the browser)
```

Dev users:

| User | Password |
|---|---|
| `admin` | `admin` |
| `alice` | `alice-vpass-dev` |
| `bob` | `bob-vpass-dev` |

`localhost` counts as a secure context, so passkeys work locally.

### Tests

| Command | What it covers |
|---|---|
| `make test` | Core unit tests: crypto round-trips and tamper detection, RFC 6238 TOTP vectors, RFC 4648 base32, the NordPass fixture, backups, generator, HIBP, health |
| `make typecheck` | `tsc` on core and `vue-tsc` on the UI |
| `make lint-php` / `make test-php` | PHP syntax check and PHPUnit service tests, run in Docker |
| `make test-api` | Black-box OCS API tests against the dev instance: concurrency 409s, tombstones, attachments, user isolation |
| `make e2e` | Playwright: onboarding, add item, lock and unlock, NordPass import, passkey unlock (virtual authenticator with PRF) |
| `make test-extension` | Extension unit tests (happy-dom): field detection, filling, submitted credentials, save-prompt decisions, message sender checks |
| `make e2e-extension` | Builds the extension, then runs it in Chromium against the dev instance and a local test site. Covers Login Flow v2, unlock, inline and popup fill, the clickjacking guard, update and save prompts, the generator, TOTP, cards, addresses, passkeys (verified with `@simplewebauthn/server`), passkey autofill, the "another device" fallback, "keep unlocked" across restarts, and the web app's "Browser extension" page connecting a fresh browser. |
| `make zk-check` | Stores a sentinel string through the API, then greps the Postgres dump and Nextcloud's data folder. Any match fails the check. |
| `make test-ios-kit` | VPassKit, the iPhone app's Swift core, in Docker: unit tests plus vectors produced by `@vpass/core` (`npm run vectors:ios`) that prove both sides read and write the same bytes |
| `make test-ios-interop` | The Swift client against the dev instance: core seeds a vault, Swift reads and edits it (including a 409), saves a passkey, and core verifies everything it wrote with `@simplewebauthn/server` |

For `make e2e`, run `npx playwright install chromium` once beforehand.

## NordPass import

The importer runs in the browser, so the CSV is never uploaded unencrypted.

- **Matching:** columns are matched by name. Known columns: `name, url, additional_urls, username, password, note, cardholdername, cardnumber, cvc, pin, expirydate, zipcode, folder, full_name, phone_number, email, address1, address2, city, country, state, type, custom_fields`.
- **Type mapping:**

| NordPass `type` | V-Pass item |
|---|---|
| `password` | login |
| `note` | secure note |
| `credit_card` | card |
| `identity` | personal info |
| `folder` | folder |

- **Older exports:** exports without a `type` column are handled by inferring the type from the filled columns.
- **Nothing is dropped:**
  - Unknown columns become custom fields.
  - Invalid `custom_fields` JSON is kept in the notes.
  - Skipped rows are listed in the preview.
- **Duplicates:** items already in the vault (same site and username) can be skipped.

The test fixture (`packages/core/test/fixtures/nordpass-export.csv`) is synthetic. To make it authoritative:
1. Create one dummy item of each type in NordPass.
2. Export them to CSV.
3. Replace the fixture with that file and run `make test`.

NordPass's documentation does not say whether the export includes passkeys or 2FA secrets. If a `totp` column exists, it is imported.

## API (for the extension and desktop client)

The OCS API lives at `/ocs/v2.php/apps/vpass/api/v1`.

- **Web UI:** authenticates with the session.
- **Other clients:** use an app password from [Login Flow v2](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html) with HTTP Basic auth. See `createFetchTransport()` in `@vpass/core`.

| Method & path | Purpose |
|---|---|
| `GET/POST/PUT/DELETE /vault` | Vault header: KDF params and wrapped keys. Setup, password or recovery-key change, delete. Delete requires Nextcloud password confirmation. |
| `GET /sync?since=N` | Items, folders and attachments changed after revision `N`, plus tombstones. Every write bumps the per-user revision. |
| `POST /items`, `POST /items/batch` | Create one item or up to 500 at once (import) |
| `PUT /items/{id}` | Update with `baseRevision`. Returns **409** with the server copy on conflict. |
| `POST /items/{id}/trash`, `POST /items/{id}/restore`, `DELETE /items/{id}` | Trash, restore, delete permanently |
| `POST/PUT/DELETE /folders[/{id}]` | Folders |
| `POST /items/{id}/attachments`, `GET/DELETE /attachments/{id}` | Encrypted files (multipart upload, ciphertext download) |
| `GET/POST/DELETE /unlock-keys[/{id}]`, `POST /unlock-keys/{id}/used` | Passkey (PRF) unlock keys |
| `GET /breach/range/{prefix}` | HIBP k-anonymity proxy, taking a 5-character SHA-1 prefix |
| `GET/PUT /admin/settings` | Admin only |

## Roadmap

- **Browser extension for Firefox,** and passkeys inside cross-origin iframes (for now the extension hands those to the browser).
- **Desktop client.**
- **Sharing items and folders** between Nextcloud users.
- **Emergency access.**
- **Email breach monitoring:** needs an HIBP API key.
- **Email masking.**
- **Website icons:** opt-in, because fetching them reveals your sites to the server.
