#!/usr/bin/env bash
# Signing helper for the TestFlight pipeline (see ios/SETUP.md). Runs on Linux.
# Everything it creates stays in ios/signing/, which is gitignored.
#
#   ios/scripts/signing.sh csr       private key + certificate signing request for Apple
#   ios/scripts/signing.sh p12       Apple's distribution.cer + the key → distribution.p12
#   ios/scripts/signing.sh check     show what is ready
#   ios/scripts/signing.sh secrets   store everything as GitHub Actions secrets (gh secret set)
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=signing
mkdir -p "$DIR"
chmod 700 "$DIR"

profile_field() { # <file> <plist key>
	openssl smime -inform der -verify -noverify -in "$1" 2>/dev/null \
		| python3 -c "import plistlib,sys; v=plistlib.loads(sys.stdin.buffer.read())['$2']; print(v[0] if isinstance(v, list) else v)"
}

find_profile() { # <profile name>
	for file in "$DIR"/*.mobileprovision; do
		[ -e "$file" ] || continue
		if [ "$(profile_field "$file" Name)" = "$1" ]; then
			echo "$file"
			return
		fi
	done
}

case "${1:-}" in
csr)
	if [ ! -f "$DIR/distribution.key" ]; then
		openssl genrsa -out "$DIR/distribution.key" 2048
		chmod 600 "$DIR/distribution.key"
	fi
	openssl req -new -key "$DIR/distribution.key" -out "$DIR/distribution.csr" \
		-subj "/emailAddress=${EMAIL:?Set EMAIL to your Apple Account email}/CN=V-Pass Distribution/C=${COUNTRY:-US}"
	echo "Upload $PWD/$DIR/distribution.csr when creating the Apple Distribution certificate,"
	echo "then save the downloaded file as $PWD/$DIR/distribution.cer and run: ios/scripts/signing.sh p12"
	;;
p12)
	[ -f "$DIR/distribution.cer" ] || { echo "Missing $DIR/distribution.cer (download it from the developer portal)"; exit 1; }
	openssl x509 -inform DER -in "$DIR/distribution.cer" -out "$DIR/distribution.pem"
	openssl rand -hex 16 | tr -d '\n' > "$DIR/p12-password"
	chmod 600 "$DIR/p12-password"
	# 3DES/SHA1 so macOS's `security import` on the CI runner can read it.
	openssl pkcs12 -export -inkey "$DIR/distribution.key" -in "$DIR/distribution.pem" -out "$DIR/distribution.p12" \
		-name "V-Pass Distribution" -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
		-passout file:"$DIR/p12-password"
	chmod 600 "$DIR/distribution.p12"
	echo "Created $DIR/distribution.p12"
	;;
check | secrets)
	app=$(find_profile "V-Pass App Store")
	autofill=$(find_profile "V-Pass AutoFill App Store")
	p8=$(ls "$DIR"/AuthKey_*.p8 2>/dev/null | head -1 || true)
	missing=0
	for item in "distribution.p12:$DIR/distribution.p12" "app profile:$app" "AutoFill profile:$autofill" "API key (AuthKey_*.p8):$p8"; do
		label=${item%%:*}
		path=${item#*:}
		if [ -n "$path" ] && [ -f "$path" ]; then echo "✓ $label: $path"; else echo "✗ $label"; missing=1; fi
	done
	[ -n "${ASC_ISSUER_ID:-}" ] && echo "✓ ASC_ISSUER_ID" || { echo "✗ ASC_ISSUER_ID (export it: App Store Connect → Users and Access → Integrations)"; missing=1; }
	[ "$missing" = 0 ] || exit 1
	team=$(profile_field "$app" TeamIdentifier)
	echo "Team ID (from the profile): $team"
	if [ "$1" = secrets ]; then
		key_id=$(basename "$p8" .p8)
		key_id=${key_id#AuthKey_}
		gh secret set IOS_TEAM_ID --body "$team"
		base64 -w0 "$DIR/distribution.p12" | gh secret set IOS_DIST_CERT_P12
		gh secret set IOS_DIST_CERT_PASSWORD < "$DIR/p12-password"
		base64 -w0 "$app" | gh secret set IOS_PROFILE_APP
		base64 -w0 "$autofill" | gh secret set IOS_PROFILE_AUTOFILL
		gh secret set ASC_KEY_ID --body "$key_id"
		gh secret set ASC_ISSUER_ID --body "$ASC_ISSUER_ID"
		base64 -w0 "$p8" | gh secret set ASC_KEY_P8
		echo "GitHub secrets set. The next push to main (or a manual run with 'Upload this commit to TestFlight') uploads a build."
	fi
	;;
*)
	sed -n '2,9p' "$0"
	exit 1
	;;
esac
