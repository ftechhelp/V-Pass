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
- **The web app trusts the JavaScript that your server sends.** A compromised server could ship modified code. This is the same trade-off as any web vault, Bitwarden's included. The planned browser extension and desktop client will ship their own code.
- **Signing in to websites with a stored passkey needs the browser extension.** A web page cannot answer another site's passkey prompt.
- **HTTPS is required.** Browsers disable WebCrypto and WebAuthn on plain HTTP.

## Repository layout

| Path | What |
|---|---|
| `packages/core` | `@vpass/core`: crypto, item schemas, NordPass importer, exporters, generator, TOTP, HIBP, health, typed API client. Framework-free, so the browser extension and desktop client can reuse it. |
| `nextcloud-app` | The Nextcloud app (`appinfo/`, `lib/` PHP, `src/` Vue 3 UI, `templates/`). Installed as `custom_apps/vpass`. |
| `e2e` | API integration tests (vitest), browser tests (Playwright) and the zero-knowledge check. |
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
| `make zk-check` | Stores a sentinel string through the API, then greps the Postgres dump and Nextcloud's data folder. Any match fails the check. |

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

- **Browser extension:** autofill, saving logins, and a WebAuthn authenticator that uses the stored passkeys.
- **Desktop client.**
- **Sharing items and folders** between Nextcloud users.
- **Emergency access.**
- **Email breach monitoring:** needs an HIBP API key.
- **Email masking.**
- **Website icons:** opt-in, because fetching them reveals your sites to the server.
