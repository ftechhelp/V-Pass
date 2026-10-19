# V-Pass for iPhone: one-time Apple setup

The iPhone app is built on GitHub's macOS runners and delivered through **TestFlight**, so no Mac is needed. Apple only signs apps with an AutoFill extension for paid developer accounts, so this needs the Apple Developer Program.

Everything below is done once. Afterwards every push to `main` that touches `ios/` or `packages/core` uploads a new build automatically.

The ids below use the defaults from `ios/project.yml` (`VPASS_BUNDLE_ID: io.github.ftechhelp.vpass`). To use your own, change `VPASS_BUNDLE_ID` there **before** step 2.

| What | Id |
|---|---|
| App | `io.github.ftechhelp.vpass` |
| AutoFill extension | `io.github.ftechhelp.vpass.autofill` |
| App Group | `group.io.github.ftechhelp.vpass` |

## 1. Join the Apple Developer Program

Enroll as an individual at <https://developer.apple.com/programs/enroll/> (US$99 a year). Approval can take up to two days.

## 2. Register the ids

At <https://developer.apple.com/account/resources/identifiers/list>:

1. **App Group:** **+** → *App Groups* → description "V-Pass", identifier `group.io.github.ftechhelp.vpass`.
2. **App id for the app:** **+** → *App IDs* → *App* → description "V-Pass", explicit bundle id `io.github.ftechhelp.vpass`. Under *Capabilities* tick:
   - **App Groups**, then *Configure* and select the group from step 1;
   - **AutoFill Credential Provider**.
3. **App id for the extension:** the same with description "V-Pass AutoFill" and bundle id `io.github.ftechhelp.vpass.autofill`, with the same two capabilities and the same group.

## 3. The distribution certificate

1. On this Linux machine: `EMAIL=you@example.com ios/scripts/signing.sh csr`. It creates a private key and `ios/signing/distribution.csr` (the folder is gitignored and never leaves the machine except as a GitHub secret).
2. At <https://developer.apple.com/account/resources/certificates/list>: **+** → **Apple Distribution** → upload the `.csr` → download the certificate and save it as `ios/signing/distribution.cer`.
3. `ios/scripts/signing.sh p12` turns it into `ios/signing/distribution.p12` with a random password.

## 4. The provisioning profiles

At <https://developer.apple.com/account/resources/profiles/list>, create two profiles of type **App Store Connect** (under *Distribution*), each with the certificate from step 3. **The names must be exactly these**, because the build looks them up by name:

| App id | Profile name |
|---|---|
| `io.github.ftechhelp.vpass` | `V-Pass App Store` |
| `io.github.ftechhelp.vpass.autofill` | `V-Pass AutoFill App Store` |

Download both into `ios/signing/`.

## 5. App Store Connect

At <https://appstoreconnect.apple.com>:

1. **The app record:** *Apps* → **+** → *New App* → iOS, name "V-Pass" (if it is taken, for example "V-Pass for Nextcloud"), bundle id `io.github.ftechhelp.vpass`, SKU `vpass`. Nothing else needs filling in for TestFlight.
2. **The upload key:** *Users and Access* → *Integrations* → *App Store Connect API* → *Team Keys* → **+**, name "V-Pass CI", access **App Manager**. Download the `AuthKey_XXXXXXXX.p8` into `ios/signing/` (Apple offers the download only once). Note the **Issuer ID** shown above the list.
3. **Testers:** in the app's *TestFlight* tab, create an internal group (for example "Me"), add yourself and turn on automatic distribution.

## 6. Hand the secrets to GitHub

```bash
ASC_ISSUER_ID=<issuer id> ios/scripts/signing.sh check    # shows what is ready
ASC_ISSUER_ID=<issuer id> ios/scripts/signing.sh secrets  # stores them with `gh secret set`
```

This sets `IOS_TEAM_ID`, `IOS_DIST_CERT_P12`, `IOS_DIST_CERT_PASSWORD`, `IOS_PROFILE_APP`, `IOS_PROFILE_AUTOFILL`, `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8` on the repository. Then start a build: GitHub → *Actions* → *iOS* → *Run workflow* with "Upload this commit to TestFlight" ticked (or push to `main`).

## 7. Export compliance (first build only)

The first build waits in App Store Connect with **Missing Compliance** until you answer Apple's encryption questions. V-Pass encrypts your vault itself with libsodium (XChaCha20-Poly1305, Argon2id), on top of HTTPS. The answers are a legal statement, so they are yours to give. Once you know them, add `ITSAppUsesNonExemptEncryption` (and, if Apple gives you one, `ITSEncryptionExportComplianceCode`) to the app's `info.properties` in `ios/project.yml`, and later builds stop asking.

## 8. Install it

1. Install **TestFlight** from the App Store on the iPhone and accept the invitation email (or open the app's TestFlight link).
2. Install V-Pass, connect it to your Nextcloud and unlock it.
3. Turn on AutoFill: **Settings → General → AutoFill & Passwords → V-Pass**. V-Pass offers to load your logins right there.

TestFlight builds expire after **90 days**. Any push that changes the app uploads a fresh one; otherwise re-run the workflow by hand.

## 9. What to try on the phone

These are the checks only a real iPhone can do:

1. Connect, unlock with the master password, turn on Face ID in Settings, close the app (swipe it away) and unlock with Face ID.
2. Airplane mode: V-Pass still unlocks and shows the vault.
3. Fill a login in Safari and in an app (the keyboard bar, and the key icon → V-Pass). Fill a 2FA code on a site's code field.
4. On <https://webauthn.io>: register a passkey and choose V-Pass; sign in with it on the iPhone, then in Chrome with the extension.
5. Use a passkey made by the Chrome extension on the iPhone.
6. Edit the same item on the phone and in the web app at the same time and save both: the phone says it was changed elsewhere.
7. AutoFill with Face ID off (master password inside the AutoFill sheet). Argon2id needs 64 MiB, and AutoFill gets much less memory than the app; if the sheet crashes, say so.
