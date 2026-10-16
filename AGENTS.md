# AGENTS.md

Guidance for coding agents working in this repository. [README.md](README.md) covers what V-Pass is from a user's point of view: install, security model and API table. This file covers how the code fits together, what has and hasn't been verified, and the traps already found.

## Project in one paragraph

V-Pass is a zero-knowledge, NordPass-style password manager that runs as a **Nextcloud 35 app** (app id `vpass`) on the owner's on-prem server.
- **Item types:** logins, passkeys, secure notes, credit cards and personal info.
- **Features:** folders, favorites, trash, password generator, password health with a Have I Been Pwned (HIBP) breach check, TOTP codes and encrypted attachments.
- **Import and export:** NordPass CSV import; encrypted `.vpass` backup and CSV export.
- **Clients:** the Nextcloud web app and a Chrome extension (`browser-extension/`); a desktop client will follow. Shared logic (crypto, schemas, importers, API client, the WebAuthn software authenticator, URL matching, the sync cache) lives in a framework-free package.

### Decisions made with the owner (don't silently change)

- **Target:** Nextcloud **35 only** (`appinfo/info.xml` min = max = 35). Vue 3 + `@nextcloud/vue` 9.
- **Zero-knowledge:** a separate master password, all crypto runs client-side, and the server stores only ciphertext.
- **Passkeys mean both:**
  - (a) website passkeys stored in the vault (`login.passkeys[]`), with the Chrome extension acting as the authenticator;
  - (b) unlocking the vault with a passkey via the WebAuthn PRF extension.
- **v1 includes** password health + HIBP, TOTP and attachments. **Sharing between users is out of v1**, but per-item keys keep that path open.
- **Chrome extension:**
  - **Distribution: the Chrome Web Store, unlisted** (owner's decision on 2026-10-16, replacing "load unpacked only").
    - It's published under the owner's developer account. The owner uploads releases, unless they provide Chrome Web Store API credentials.
    - The submission kit is `browser-extension/store/LISTING.md` plus `PRIVACY.md`.
    - Until the listing exists, the web app's "Browser extension" page offers the zip for a manual install.
  - It unlocks with the master password.
  - The opt-in **"Keep unlocked on this device"** (with a warning) persists the vault key in `chrome.storage.local` until the user locks. This was the owner's explicit choice; keep the warning.
  - v1 covers login fill, save/update prompts, the generator, TOTP, cards and identities, and passkeys (create, sign in, conditional mediation).

## Verification status — read this first

| Area | Status |
|---|---|
| `@vpass/core` unit tests (80) | ✅ passing (`npm test`). The authenticator's output is verified with `@simplewebauthn/server` |
| `tsc` (core, e2e) and `vue-tsc` (app, extension) | ✅ clean |
| Extension unit tests (27, happy-dom) | ✅ passing (`make test-extension`) |
| Extension end-to-end tests (11, Chromium + dev Nextcloud), including the web app's "Browser extension" page connecting a fresh browser | ✅ passing (`make e2e-extension`) |
| Chrome Web Store listing | ❌ not submitted yet. Waiting for the owner's developer account; then set `CHROME_WEB_STORE_URL` (see `browser-extension/store/LISTING.md`) |
| Extension on real websites (webauthn.io, GitHub passkeys, real login forms) | ❌ not tried yet. Field detection is heuristic, so expect per-site fixes |
| Vite production build | ✅ builds `nextcloud-app/js/vpass-main.mjs` and `vpass-admin.mjs` |
| `make lint-php`, PHPUnit (31) | ✅ passing |
| Migration + API tests, Playwright UI tests, zero-knowledge check (`e2e/`) | ✅ passing on Nextcloud 35.0.2 with Postgres 17 (dev stack) and MariaDB 11.4 (one-off stack); zk-check only runs on Postgres (`pg_dump`) |
| Real NordPass export | ❌ importer only tested against a synthetic fixture |
| Production install | ✅ v0.2.0 on the owner's Nextcloud (35.0.2, MariaDB 11.4): installed as 0.1.0 on 2026-10-16, then updated to 0.1.1 and 0.2.0 (the "Browser extension" page) the same day. It shares this Docker host with other production services. Apart from the V-Pass update procedure below, never change it, or any container outside the `vpass-dev` compose project, without asking |

**Ship every tested change to production (standing instruction from the owner).**
- **When:** once a change is finished and its tests pass on the throwaway dev stack, update V-Pass on the owner's production Nextcloud so they can test it too. Don't wait to be asked.
- **Never ship** a change whose tests fail, or one that was not tested on the dev stack.
- **Scope:** the procedure touches only the `vpass` app.

1. **Back up the database.**
   - Run `mariadb-dump --single-transaction` in the `nextcloud-mariadb` container. Use its `MYSQL_ROOT_PASSWORD` env var without printing it.
   - Write the dump to `~/backups/nextcloud-db-pre-vpass-<new version>-<timestamp>.sql.gz` with mode 600.
   - Check that it ends with "Dump completed".
2. **Check nothing else is pending.** `occ status` must show `maintenance: false` and `needsDbUpgrade: false`. Otherwise stop and ask: `occ upgrade` would also upgrade whatever else is pending.
3. **Bump `<version>`** in `appinfo/info.xml`: patch for fixes, minor for features.
   - This makes Nextcloud run new migrations and browsers drop the cached JS.
   - Nextcloud never downgrades an app, so never reuse or lower a version.
   - The dev instance mounts the same folder, so it now needs `make dev-upgrade`; otherwise it answers 503.
4. **Build:** `make appstore`. This also packages the extension (`make extension-zip`) into the app, for the web app's download.
5. **Swap the app folder.**
   - `docker cp build/vpass nextcloud:/tmp/vpass-new`.
   - Inside the container: `chown -R www-data:www-data /tmp/vpass-new`, remove `/var/www/html/custom_apps/vpass`, then move `/tmp/vpass-new` into its place.
6. **Upgrade:** run `occ upgrade` (`docker exec -u www-data nextcloud php occ upgrade`), then confirm the new version with `occ config:app:get vpass installed_version` and `occ app:list`.
   - **Expected error at the end:** `Could not resolve OCP\AppFramework\Services\IAppConfig! Class can not be instantiated`.
   - It is harmless and comes from production, not V-Pass. Production's *disabled* Mail and Talk apps have migrations that inject the app-scoped `IAppConfig`. Nextcloud 35's post-upgrade schema check replays disabled apps' migrations without their app container, so it fails after the real upgrade has finished.
   - Rely on `installed_version` and step 7 instead of the exit code.
7. **Verify.**
   - `status.php` returns 200 through the public URL.
   - `/index.php/apps/vpass/` redirects to the login page.
   - `occ status` shows no maintenance mode.
   - The Nextcloud log (`data/nextcloud.log`) has no new level ≥ 3 entries since the update.
8. **Extension changes.**
   1. Bump `version` in `browser-extension/public/manifest.json`. The Chrome Web Store rejects an upload whose version isn't higher than the last one.
   2. `make appstore` (step 4) puts the new zip into the web app's download.
   3. Hand over `build/vpass-extension-<version>.zip` for the Chrome Web Store: the owner uploads it under *Package → Upload new package* and submits it for review. Use the Web Store API instead if credentials have been set up.
   4. Before review finishes, the owner can test right away with the unpacked `browser-extension/dist` (reload it in `chrome://extensions`).
9. **Report to the owner:**
   - the version deployed;
   - what changed and what to test;
   - the backup path;
   - to roll back, restore the backup and the previous `build/vpass-<version>.tar.gz`.

Production has disabled apps with leftover background jobs, so `occ background-job:list` logs harmless "failed to create instance" warnings.

**Full verification run** (Docker works for the user now; run `npx playwright install chromium` once):
1. `make install`
2. `make lint-php`
3. `make test-php`
4. `make dev-up`
5. `make test-api`
6. `make e2e`
7. `make zk-check`
8. `make test-extension`
9. `make e2e-extension` (builds the extension first)

## Commands

Run from the repo root unless noted. Node 22+ and npm workspaces.

```bash
npm install                      # all workspaces
npm test                         # @vpass/core unit tests (vitest)
npm run typecheck                # tsc on core + vue-tsc on the app
npx tsc -p e2e/tsconfig.json     # typecheck the e2e suites
npm run build                    # production UI build → nextcloud-app/js/
npm run dev                      # rebuild the UI on change
npm run build:extension          # Chrome extension → browser-extension/dist (load unpacked)
npm run dev:extension            # rebuild the extension on change, then reload it in chrome://extensions
npm run test:extension           # extension unit tests (vitest + happy-dom)
make extension-zip               # build/vpass-extension-<version>.zip for the Chrome Web Store (+ the web app's download copy)
make store-images                # regenerate the Chrome Web Store screenshots (dev instance must be up)
make dev-upgrade                 # occ upgrade on the dev instance, needed after an app version bump
make help                        # all make targets
```

**Running a single test:**

```bash
# core: one file, or by test name (run inside packages/core)
cd packages/core && npx vitest run test/crypto.test.ts
cd packages/core && npx vitest run -t "recovery key"

# PHP: one class (Docker, needs `make install` first for vendor/)
docker run --rm -v "$PWD/nextcloud-app:/app" -w /app composer:2 vendor/bin/phpunit -c tests/phpunit.xml --filter ItemServiceTest

# API / UI tests need the dev instance (`make dev-up`)
npx vitest run -c e2e/vitest.config.ts
npx playwright test -c e2e/playwright.config.ts -g "onboarding"
```

**`-t` / `-g` filters are unreliable in `e2e/`.** The tests in each file are serial and stateful:
- In `e2e/api/vault-api.test.ts`, vault creation is itself a test, and later tests use the vault it creates.
- The Playwright passkey test assumes the onboarding test already created a vault.
- `e2e/extension/extension.spec.ts` connects and unlocks in its first test, and every later test relies on that.

So filtering out the earlier tests breaks the later ones.

**e2e environment variables:**

| Variable | Effect | Default |
|---|---|---|
| `VPASS_URL` | Nextcloud base URL | `http://localhost:8080` |
| `VPASS_ADMIN_USER` / `VPASS_ADMIN_PASSWORD` | Admin login | `admin` / `admin` |
| `VPASS_TEST_HIBP=1` | Enables the live HIBP proxy test | off |
| `VPASS_ZK_CHECK=1` | Enables the database/data-folder plaintext grep (set by `make zk-check`) | off |
| `VPASS_KEEP_USERS=1` | Keeps the throwaway Nextcloud users after the run | off |

**Dev instance:**
- `make dev-up` builds the UI and starts `dev/docker-compose.yml` (Nextcloud 35, Postgres 17, Redis) on `http://localhost:8080`.
- `nextcloud-app/` is bind-mounted as `custom_apps/vpass`.
- `dev/setup.sh` enables the app and creates `alice` / `bob`; passwords are in the README.
- PHP tooling runs in the `composer:2` image.

**Release:** `make appstore` produces `build/vpass-<version>.tar.gz` from `appinfo img js lib templates`, with source maps stripped. `js/` is gitignored, so it must be built first; the target does that.

## Architecture

### Repo layout

- **`packages/core` → `@vpass/core`:**
  - It has no build step. `package.json` exports `src/index.ts` directly, and consumers (Vite, vitest, the extension) bundle the TypeScript.
  - Internal imports use explicit `.ts` extensions, so every consumer's tsconfig needs `allowImportingTsExtensions`.
  - `"sideEffects": false`: bundles drop the modules they don't use (without it, the popup pulled in papaparse through the barrel export). Keep core modules free of top-level side effects.
- **`nextcloud-app`:** the Nextcloud app. `lib/` is PHP (namespace `OCA\VPass`), `src/` is the Vue UI, `templates/` holds two stub templates.
- **`browser-extension`:** the Chrome extension (MV3, Vue 3, plain Vite). See "Chrome extension" below.
- **`e2e`:** API tests (vitest + the core client over HTTP), Playwright UI tests, the zero-knowledge script, and `helpers.ts`, which creates and deletes throwaway users through the provisioning API. Deleting the users also exercises `UserDeletedListener`.

### Key hierarchy and crypto conventions (`packages/core/src/crypto`)

```
master password ─NFKC→Argon2id (64 MiB, ops 3)→ master key ─kdf "vpassKEK"→ KEK ─wraps→ Vault Key (VK)
recovery key (32 B + 3 B BLAKE2b checksum = 56 base32 chars) ─kdf "vpassRCV"→ wraps VK
WebAuthn PRF output (32 B) ─kdf "vpassPRF"→ wraps VK          (one wrap per registered passkey)
VK ─wraps→ per-item / per-folder key ─XChaCha20-Poly1305→ JSON payload
per-item key ─wraps→ per-attachment key ─secretstream (64 KiB chunks)→ file bytes; name/MIME in `meta`
```

- **Initialization:** `await initCrypto()` once (it loads the libsodium WASM). After that the crypto API is synchronous and uses `na()`.
- **Envelope format:** a single string `1.<nonce b64url>.<ciphertext b64url>` (`envelope.ts`). The PHP `Validator` enforces this format.
- **Associated data:**
  - Every ciphertext is bound to a purpose and an object id through AEAD associated data. The labels live in `AAD` in `keys.ts`.
  - A new kind of ciphertext needs its own AAD label that includes the object id.
  - KDF contexts must be exactly 8 bytes.
- **What the KDF params protect:** they are stored in the clear with the vault and can be raised later. A server that sends weaker params cannot leak anything; the unwrap simply fails.
- **Changing the master password** only re-wraps the VK (`rewrapWithPassword`). Items are never re-encrypted.
- **Randomness:** use core's `uuid()` and `randomBytes()` (backed by `getRandomValues`). `crypto.randomUUID` was avoided because of extension contexts.
- **WebCrypto** is used for TOTP HMAC, HIBP's SHA-1 and the passkey authenticator (ECDSA P-256 / RSA keys, `webauthn/authenticator.ts`). All need a secure context.

### Item model (`model/items.ts`)

- **Schema format:**
  - Zod schemas built with **`z.looseObject`**, so fields written by a newer client survive a round-trip through an older one.
  - `schemaVersion` sits in the payload.
- **Everything is encrypted:** type, title, folder, favorite and timestamps all live inside the encrypted payload.
- **What the server sees:** only uuid, revision, created/updated/deleted timestamps and the attachment ciphertext size.
- **Passkeys:**
  - Website passkeys are stored inside logins (`login.passkeys[]`: credentialId, rpId, userHandle, PKCS#8 `privateKey`, COSE alg, signCount).
  - The authenticator creates ES256 or RS256 keys, uses "none" attestation with the fixed `VPASS_AAGUID`, and sets the UP/UV/BE/BS flags. **`signCount` is always 0**, as with other synced passkeys, so sync can never trip a site's clone detection.
  - The "Passkeys" sidebar category is just a filter over logins that have passkeys.
- **`updateItem()`** maintains `updatedAt`, `passwordChangedAt` and `passwordHistory` (the last 20 entries).

### Wire contract — change both sides together

The TypeScript side (`model/records.ts` + `api/client.ts`) mirrors the PHP side: entity `jsonSerialize()` and the controller routes.

- **IDs:**
  - The public `id` is a **client-generated UUID**, stored in the `uuid` column.
  - The DB `id` column is an internal autoincrement.
  - Exception: unlock keys use their numeric DB id.
- **Routes:** attribute routing (`#[ApiRoute]`) under `/ocs/v2.php/apps/vpass/api/v1/…`. There is no `appinfo/routes.php`.
- **Sync and concurrency:**
  - Each user has a counter, `vpass_vaults.revision`.
  - Every write calls `RevisionService::next()` inside a transaction. That calls `VaultMapper::bumpRevision`; the row lock serializes concurrent writes.
  - Clients pull changes with `GET /sync?since=N`.
  - Hard deletes write rows to `vpass_tombstones`.
  - Updates must send `baseRevision`. A stale one gets **409 with `current`** (the server copy). In core this surfaces as `ConflictError`. The web store then loads the server copy; the extension re-applies its single change to the server copy and retries once.
  - **A client's own writes only advance its sync revision when the write is exactly `revision + 1`** (`advanceRevision` in the web store, `VaultCache.putItem` in core). Otherwise another device's change in between would be skipped. Sync responses still use the max.
- **Transports:** `VPassApi` takes an injected `Transport`.
  - Web app: `nextcloud-app/src/services/api.ts` (`@nextcloud/axios`, unwraps `ocs.data`).
  - Extension, desktop and tests: `createFetchTransport()` (Basic auth with a Login Flow v2 app password).

### Server (`nextcloud-app/lib`)

- **Request path:** `OCSController`s (via `BaseApiController`) → services → mappers (`UserScopedMapper` holds the shared `findByUuid`, `findChangedSince` and `deleteByUser`).
- **Exception mapping in `BaseApiController::handle()`:**

| Exception | Response |
|---|---|
| `NotFoundException` | OCS 404 |
| `ValidationException` | 400, or 413 for oversize uploads |
| `ConflictException` | 409 with the server copy |

- **Validation:** the server never decrypts anything. `Validator` enforces UUID, envelope and KDF shapes and size limits, so plaintext payloads are rejected with 400.
- **Transactions:** services use `TTransactional::atomic()`.
- **Attachments:** ciphertext goes to **IAppData** (`appdata_<instance>/vpass/<uid>/<uuid>`), not the user's Files. Download returns a `StreamResponse`.
- **CSP:** `PageController` sets `allowEvalWasm(true)` (Nextcloud 28+) because libsodium is WASM. Never add `unsafe-eval`; the bundle currently contains no `eval` or `new Function`.
- **HIBP:** proxied by the server (`HibpService`: 5-hex-character prefix, `Add-Padding`, 24 h distributed cache, admin toggle). This keeps `connect-src` locked down.
- **Admin settings:**
  - Stored in `IAppConfig` typed values: `hibp_enabled`, `max_attachment_mb`, `trash_retention_days`.
  - The panel appears in the **Security** admin section.
  - The effective attachment limit is capped by PHP's `upload_max_filesize` and `post_max_size`.
- **`DELETE /vault`** has `#[PasswordConfirmationRequired]`, and the web UI calls `confirmPassword()` first. Behaviour for Basic-auth API clients is untested.
- **Extension download:** `ExtensionController` (logged-in users) streams `extension/vpass-extension.zip`, and `ExtensionPackage` validates `extension/extension.json`. Both files are written by `make extension-zip`, gitignored, and shipped by `make appstore`. Without them, the download returns 404 and the page says so.
- **Background job:** `PurgeTrash` runs daily and deletes trash older than the retention setting. Deleting a Nextcloud user wipes their vault (`UserDeletedListener`).

### Web app (`nextcloud-app/src`)

- **Stack:** Vue 3 + Pinia + vue-router with **hash history**, so no server routes are needed for deep links. It mounts into `#content`.
- **Screen states:** `App.vue` switches on `session.status` (`loading | error | setup | locked | unlocked`) plus `session.onboarding`. It refuses to run outside a secure context (HTTPS or localhost).
- **Key storage:**
  - The **vault key lives only in the module-scoped `vaultKey` in `stores/session.ts`.** It is never reactive and never persisted, so a reload locks the vault.
  - Per-item and per-folder keys live in module-level `Map`s in `stores/vault.ts`.
- **Vault entries:** kept in `shallowRef(Map)`. Mutate, then call `notify()` (`triggerRef`), or computed values won't update.
- **Store imports:** `session` and `vault` import each other. That is fine because each uses the other only at call time.
- **Argon2id** runs on the main thread. `nextFrame()` is awaited first so the spinner can paint. Moving it to a Web Worker is a known improvement.
- **Browser storage:** `localStorage` holds only conveniences, under `vpass:preferences` (auto-lock, clipboard clear, lock on hide) and `vpass:generator`.
- **zxcvbn dictionaries** (~1.2 MB chunk) are lazy-loaded. `checkStrength()` throws until `loadStrengthEstimator()` resolves, so use `useStrength()` / `ensureStrengthEstimator()`.
- **Build:**
  - `@nextcloud/vite-config` reads the app id from `appinfo/info.xml` and emits `js/vpass-main.mjs` and `js/vpass-admin.mjs`.
  - `inlineCSS: { relativeCSSInjection: true }` makes each entry inject its own CSS, so PHP only needs `Util::addScript()`.
  - Initial-state keys: `config` (main app) and `admin-settings`.
- **"Browser extension" page** (`views/ExtensionView.vue`, `services/extension.ts`):
  - It talks to the extension with `window.postMessage`: `{ vpass: 'webapp', kind: 'status' | 'connect' }` goes out, and `{ vpass: 'extension', … }` comes back.
  - It shows install, connect and update state.
  - **`CHROME_WEB_STORE_URL`** stays empty until Google approves the listing. While it's empty, the page offers the bundled zip (`config.extensionVersion`, downloaded from `/apps/vpass/extension/download`) with load-unpacked steps.
- **Playwright selectors:** `data-test="…"` attributes are what the Playwright tests select on. Keep them when refactoring.
- **Translations:** user-facing strings use `t('vpass', …)` / `n(...)`. No translation files exist yet.

### Chrome extension (`browser-extension`)

- **Build:** one `vite.config.ts` with four modes, all writing into `dist/` (`npm run build` runs them in order):

| Mode | Output |
|---|---|
| `pages` | The Vue pages: `popup`, `options`, `prompt` (the passkey consent and unlock window), `inline-menu`, `notification-bar`, `offscreen`, plus `public/` with the static `manifest.json` and icons |
| `background` | The module service worker as **one file** (`inlineDynamicImports`), because service workers can't use dynamic `import()` |
| `content` | The isolated-world content script, as an IIFE |
| `main-world` | The page-world WebAuthn shim, as an IIFE |

  Output is unminified with source maps, so the unpacked extension is easy to audit. `@nextcloud/vue` is not used, because it needs Nextcloud page globals. Pages use `src/pages/ui/styles.css` and `vue-material-design-icons`.
- **Contexts and trust** (`shared/protocol.ts` has the typed message maps; `background/router.ts` enforces them via `senderKind`):

| Sender | Allowed messages | Rules |
|---|---|---|
| `page`: popup, options, prompt | `UiMessages` | Full access |
| `frame-ui`: inline-menu and notification-bar iframes | `FrameUiMessages` | Only token-scoped calls. The background checks that the iframe sits in the same tab the token was issued for |
| `content`: content scripts | `ContentMessages` | **The origin always comes from `sender`** (`pageUrlOf`/`originOf`), never from the message |

  Anything else is refused. Background→content commands are `ContentCommand`s; content scripts accept them only from the extension itself (no `sender.tab`).
- **The service worker owns every secret.** Pages and content scripts get only what they show or fill. Module state is lost whenever Chrome stops the worker, so:
  - State that must survive lives in `chrome.storage.session` through `SessionMap`: frame registry, inline tokens, passkey grants, pending save prompts, pending passkey requests, the login flow.
  - The vault key is re-read by `getVaultKey()`.
  - Items are decrypted again lazily from the encrypted `VaultCache` in `chrome.storage.local`.
- **Storage:**
  - `chrome.storage.local` holds the account (server, loginName, app password), settings, the never-save list, the encrypted cache plus vault meta (for offline unlock), and `persistedVaultKey` **only while Keep unlocked is on**.
  - `chrome.storage.session` holds the vault key. Chrome clears it when it closes.
  - `lock()` wipes both copies of the key but keeps the checkbox choice (`keepUnlocked`).
  - `sync()` locks and clears the cache if the server's vault `createdAt` changed (the vault was deleted and recreated).
- **Auto-lock** uses `chrome.idle`: the system idle time and screen lock. Keep unlocked disables both.
- **Connecting** uses Login Flow v2 (`background/account.ts`):
  - Polling runs on a timer, a 30 s alarm and login-tab updates, so a stopped worker still finishes the flow.
  - Fetches use `credentials: 'omit'`, so a Nextcloud browser session never mixes with the app password.
  - Disconnecting revokes the app password with `DELETE /ocs/v2.php/core/apppassword`.
- **Autofill:**
  - Content scripts classify fields in `content/classify.ts` (`autocomplete` first, then hints and position) and report a `FrameForms` summary per frame.
  - Fills only ever happen on a user action: the inline menu, the popup, the shortcut or the context menu. Only visible fields are filled.
  - Logins fill only into a frame whose URL matches the item (`matchUrl`); http, or a non-matching site, needs a confirm (`force`).
  - Cards and identities from the popup go to same-origin frames first. A third-party frame needs a confirm.
  - Inline-menu fills go only to the frame that opened the menu.
- **In-page UI** (`content/overlay.ts`):
  - It sits in a closed shadow root on `<html>`, with `!important` `:host` styles (shadow-internal `!important` beats the page's).
  - The menu and the bar are extension iframes. Only a height or close number is posted to the page.
  - **Clickjacking guard** (`pages/ui/visibility.ts`): clicks count only after IntersectionObserver v2 has reported the iframe `isVisible` for 400 ms. The e2e test fades the page and checks that nothing fills.
- **Passkeys:**
  - `content/webauthn-main.ts` (MAIN world, `document_start`) wraps `navigator.credentials.create/get` and posts JSON options to `content/bridge.ts`, which forwards them to `background/fido2.ts`.
  - `fido2.ts` validates the RP ID against the sender origin and the Public Suffix List (`resolveRpId`). It opens the `prompt` window, keeps the request in session storage, and sends the result back as a `fido2Result` command.
  - The prompt sends a heartbeat every 10 s to keep the worker alive.
  - **A new passkey is saved to the server before the response goes back to the site.**
  - "Use another device" returns `fallback` → the shim calls the saved native function.
  - Cross-origin iframes, `mediation: 'conditional'` create, and unsupported algorithms all fall back to the browser.
  - Get requests while unlocked with no matching passkey fall back immediately, without a window.
  - Conditional mediation: the pending request shows passkeys in the inline menu. Picking one creates a 60 s one-time **grant** (`consumeGrant`) that the frame's `fido2Get` must present, so a page can't get silent assertions.
- **The V-Pass web app itself** (`shared/vpass-app.ts`, any `…/apps/vpass/` path) is special-cased.
  - The content script runs only the web-app bridge (`content/webapp.ts`): no autofill and no save prompts, which would offer to store the master password.
  - The MAIN-world shim doesn't wrap WebAuthn there, so the app's PRF unlock reaches Chrome.
  - `webAppStatus` / `webAppConnect` (`background/webapp.ts`) accept only a top-frame https or localhost V-Pass page.
  - The page learns only the version and whether the extension is connected to *this* server.
  - Connecting opens the prompt window in `#connect=<server>` mode; the user confirms there before Login Flow v2 starts.
  - Nothing happens if the extension is already connected.
- **Passkey requests that need PRF, largeBlob, hmac-secret or credBlob** go straight to the browser, because V-Pass's authenticator can't provide them.
- **Save prompts** (`background/save.ts`): `classifySubmission` decides new / update / nothing. The prompt is kept per tab for 5 minutes, and the next page load asks for it (`pendingSaveBar`). Prompts appear only while unlocked.

## Gotchas found so far

- **vue-tsc bug:** a static attribute containing `//` (for example `placeholder="https://example.com"`) on a component inside `v-for` breaks scope, and the v-for variables report "Cannot find name". Bind it as an expression instead; see `PLACEHOLDER` in `UrlsEditor.vue`.
- **No type narrowing in templates:** `v-if="draft.type === 'login'"` does not narrow the item union (the loose-object index signature makes the other fields `unknown`). `ItemEditor.vue` uses typed computed views (`login`, `card`, `identity`) instead. A generic `ListEditor` slot component was replaced by the concrete `UrlsEditor` / `CustomFieldsEditor` while chasing the `//` bug above. It wasn't the cause, but the concrete editors are simpler, so they stayed.
- **`@nextcloud/vue` 9 API:**
  - `NcButton` uses `variant`; `type` is the native button type.
  - v-models: `NcAppContent v-model:show-details`, `NcDialog v-model:open`, `NcModal v-model:show`.
  - `NcTextField` has no `type="date"`.
  - Import components as `@nextcloud/vue/components/NcX`.
  - Use `showConfirmation` / `showUndo` from `@nextcloud/dialogs` instead of `window.confirm`.
- **Version pins:**
  - **Vite ^7**: `@nextcloud/vite-config` 2.5 peers on Vite 7, not 8.
  - **TypeScript ~5.9**: TS 7 is current, but vue-tsc compatibility is unverified.
  - Node 26 on the dev machine triggers harmless `EBADENGINE` warnings (Nextcloud packages declare Node 20–24).
  - npm 11 skips unapproved install scripts (such as esbuild's postinstall); the build still works.
- **`data-test` on Nextcloud inputs:** `NcTextField` / `NcPasswordField` forward attributes to the `<input>` itself, not a wrapper. The spec's `field()` helper matches both shapes; plain `[data-test="x"] input` only works for wrapper components such as `PasswordInput`.
- **First-run wizard:** Nextcloud's welcome modal covers the page for every new user, including the e2e throwaway users. `dev/setup.sh` disables `firstrunwizard` on the dev instance.
- **PHPUnit and `nextcloud/ocp`:** the package has no autoload rules, so `composer.json` maps `OCP\` / `NCU\` in `autoload-dev`, and `doctrine/dbal` ^3.10 (the version bundled with Nextcloud 35) is a dev dependency for `IQueryBuilder`'s constants.
- **e2e is ESM:** `e2e/package.json` sets `"type": "module"`; without it Playwright loads the specs as CommonJS and `import.meta` fails.
- **libsodium types:** `libsodium-wrappers-sumo` 0.8 ships its own types. Don't add `@types/libsodium-wrappers-sumo`, which is now a stub.
- **NordPass format:**
  - The column list was taken from Bitwarden's open-source NordPass importer.
  - Whether the export includes passkeys or TOTP is undocumented. A `totp`/`otp` column is mapped if present; other unknown columns become custom fields.
  - Folder names are deduplicated case-insensitively, keeping the first-seen casing.
  - The fixture `packages/core/test/fixtures/nordpass-export.csv` is synthetic. Replace it with a real dummy export when the owner provides one.
- **CSV export:** it deliberately does **not** escape spreadsheet formulas, because it is meant for import into other password managers.
- **PRF unlock passkeys** are bound to the Nextcloud hostname (rpId), so the extension and desktop client need their own unlock methods. The extension uses the master password, plus the opt-in Keep unlocked.
- **Extension, Node vs Chrome:** Node's `URL` gives `chrome-extension://` URLs a `"null"` origin. The router compares against the `chrome.runtime.getURL('')` prefix instead.
- **Extension tests (Playwright):**
  - Launch with `chromium.launchPersistentContext(dir, { channel: 'chromium', args: ['--load-extension=…'] })`. New headless supports extensions.
  - The V-Pass UI is in a **closed** shadow root, so locators can't reach it. Use `page.frames()` for the iframes, and mouse coordinates for the field icon (`clickFieldIcon`).
  - The iframes ignore clicks for 400 ms (clickjacking guard); `vpassFrame()` waits for that.
  - "Active tab" logic: open the popup as a tab, then `bringToFront()` the site and `reload()` the popup.
  - The Keep unlocked checkbox remembers the last choice, so tests must set it explicitly.
  - The Login Flow v2 page has two "log in" buttons. Use `{ name: 'Log in', exact: true }`.
- **Inline menu auto-open** happens only on empty username, password and code fields, and only when there is something to offer. It closes as soon as the user types; otherwise it covers the submit button. The open re-checks focus and emptiness after its awaits.
- **Field-detection traps:**
  - `<label>` text includes nested `<option>` text ("United States" read as a state field). `labelText()` skips nested controls.
  - "MM/YY" contains "mm", so check the combined expiry pattern before month/year.
- **Version bumps affect the dev instance too:** it mounts `nextcloud-app/`, so after bumping `info.xml` it answers 503 until `make dev-upgrade`.
- **Store images:** on this machine `system-ui` resolves to a monospace font (Adwaita Mono). `store-images.spec.ts` injects a generic `sans-serif` and serves the fictional `https://mail.northwind.example` through `context.route`, so no real site or port shows up.
- **Nextcloud 36:** `appinfo/info.xml` caps `max-version` at 35, so it must be bumped for Nextcloud 36.

## Not done yet (known follow-ups)

**Smaller items:**
- OpenAPI spec generation (`nextcloud/openapi-extractor`) and a client generated from it (the client is currently hand-written).
- Argon2id in a Web Worker.
- Virtual scrolling for very large vaults.
- An unsaved-changes route guard in the editor.
- Generator history.
- l10n files.

**Extension follow-ups:**
- Submit to the Chrome Web Store (owner's account), then set `CHROME_WEB_STORE_URL`. Optionally automate uploads with the Chrome Web Store API.
- Try it on real sites and tune `classify.ts`.
- Passkeys in cross-origin iframes.
- Save prompts while locked (unlock, then save).
- The PRF/largeBlob extensions for sites.
- EdDSA keys (for imported passkeys).
- Firefox port.
- Moving the web store onto core's `VaultCache`.

**Roadmap:**
- Desktop client.
- Sharing via X25519 key pairs that wrap per-item keys.
- Emergency access.
- Email breach monitoring (needs a paid HIBP key).
- Email masking.
- Opt-in website icons.

## Conventions

- **Indentation:** tabs (see `.editorconfig`), except JSON, YAML and Markdown, which use 2 spaces.
- **PHP files:** `declare(strict_types=1)`; constructor property promotion; Entity properties are untyped `protected $x` with `addType(Types::STRING|INTEGER)`; getters and setters are documented with `@method` docblocks.
- **Never commit vault data:** `.gitignore` excludes `*.vpass` and `nordpass*.csv`, except the test fixture.
