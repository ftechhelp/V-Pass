# AGENTS.md

Guidance for coding agents working in this repository. [README.md](README.md) covers what V-Pass is from a user's point of view: install, security model and API table. This file covers how the code fits together, what has and hasn't been verified, and the traps already found.

## Project in one paragraph

V-Pass is a zero-knowledge, NordPass-style password manager that runs as a **Nextcloud 35 app** (app id `vpass`) on the owner's on-prem server.
- **Item types:** logins, passkeys, secure notes, credit cards and personal info.
- **Features:** folders, favorites, trash, password generator, password health with a Have I Been Pwned (HIBP) breach check, TOTP codes and encrypted attachments.
- **Import and export:** NordPass CSV import; encrypted `.vpass` backup and CSV export.
- **Future clients:** a browser extension and a desktop client will follow. Everything they will need (crypto, schemas, importers, API client) lives in a shared, framework-free package.

### Decisions made with the owner (don't silently change)

- **Target:** Nextcloud **35 only** (`appinfo/info.xml` min = max = 35). Vue 3 + `@nextcloud/vue` 9.
- **Zero-knowledge:** a separate master password, all crypto runs client-side, and the server stores only ciphertext.
- **Passkeys mean both:**
  - (a) website passkeys stored in the vault (`login.passkeys[]`), for the future extension to act as the authenticator;
  - (b) unlocking the vault with a passkey via the WebAuthn PRF extension.
- **v1 includes** password health + HIBP, TOTP and attachments. **Sharing between users is out of v1**, but per-item keys keep that path open.

## Verification status — read this first

| Area | Status |
|---|---|
| `@vpass/core` unit tests (61) | ✅ passing (`npm test`) |
| `tsc` (core, e2e) and `vue-tsc` (app) | ✅ clean |
| Vite production build | ✅ builds `nextcloud-app/js/vpass-main.mjs` and `vpass-admin.mjs` |
| `make lint-php`, PHPUnit (28) | ✅ passing |
| Migration + API tests, Playwright UI tests, zero-knowledge check (`e2e/`) | ✅ passing on Nextcloud 35.0.2 with Postgres 17 (dev stack) and MariaDB 11.4 (one-off stack); zk-check only runs on Postgres (`pg_dump`) |
| Real NordPass export | ❌ importer only tested against a synthetic fixture |
| Production install | ✅ v0.1.0 installed 2026-10-16 on the owner's Nextcloud (35.0.2, MariaDB 11.4). It shares this Docker host, so never touch containers outside the `vpass-dev` compose project without asking |

**Updating production** (only when the owner asks): back up the database first. Bump `<version>` in `appinfo/info.xml` and run `make appstore`. Replace `custom_apps/vpass` in the production container with `build/vpass` (`docker cp`, then `chown -R www-data:www-data`), then run `occ upgrade` so new migrations apply. Production has disabled apps with leftover background jobs, so `occ background-job:list` logs harmless "failed to create instance" warnings.

**Full verification run** (Docker works for the user now; run `npx playwright install chromium` once):
1. `make install`
2. `make lint-php`
3. `make test-php`
4. `make dev-up`
5. `make test-api`
6. `make e2e`
7. `make zk-check`

## Commands

Run from the repo root unless noted. Node 22+ and npm workspaces.

```bash
npm install                      # all workspaces
npm test                         # @vpass/core unit tests (vitest)
npm run typecheck                # tsc on core + vue-tsc on the app
npx tsc -p e2e/tsconfig.json     # typecheck the e2e suites
npm run build                    # production UI build → nextcloud-app/js/
npm run dev                      # rebuild the UI on change
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
  - It has no build step. `package.json` exports `src/index.ts` directly, and consumers (Vite, vitest, the future extension) bundle the TypeScript.
  - Internal imports use explicit `.ts` extensions, so every consumer's tsconfig needs `allowImportingTsExtensions`.
- **`nextcloud-app`:** the Nextcloud app. `lib/` is PHP (namespace `OCA\VPass`), `src/` is the Vue UI, `templates/` holds two stub templates.
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
- **WebCrypto** is used only for TOTP HMAC and HIBP's SHA-1. Both need a secure context.

### Item model (`model/items.ts`)

- **Schema format:**
  - Zod schemas built with **`z.looseObject`**, so fields written by a newer client survive a round-trip through an older one.
  - `schemaVersion` sits in the payload.
- **Everything is encrypted:** type, title, folder, favorite and timestamps all live inside the encrypted payload.
- **What the server sees:** only uuid, revision, created/updated/deleted timestamps and the attachment ciphertext size.
- **Passkeys:**
  - Website passkeys are stored inside logins (`login.passkeys[]`: credentialId, rpId, userHandle, PKCS#8 `privateKey`, COSE alg, signCount).
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
  - Updates must send `baseRevision`. A stale one gets **409 with `current`** (the server copy). In core this surfaces as `ConflictError`; the web store then loads the server copy.
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
- **Playwright selectors:** `data-test="…"` attributes are what the Playwright tests select on. Keep them when refactoring.
- **Translations:** user-facing strings use `t('vpass', …)` / `n(...)`. No translation files exist yet.

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
- **PRF unlock passkeys** are bound to the Nextcloud hostname (rpId), so the extension and desktop client need their own unlock methods.
- **Nextcloud 36:** `appinfo/info.xml` caps `max-version` at 35, so it must be bumped for Nextcloud 36.

## Not done yet (known follow-ups)

**Smaller items:**
- OpenAPI spec generation (`nextcloud/openapi-extractor`) and a client generated from it (the client is currently hand-written).
- Argon2id in a Web Worker.
- Virtual scrolling for very large vaults.
- An unsaved-changes route guard in the editor.
- Generator history.
- l10n files.

**Roadmap:**
- Browser extension: autofill, plus a WebAuthn authenticator using `login.passkeys[]`.
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
