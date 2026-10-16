#!/usr/bin/env bash
# Wait for the dev Nextcloud to finish installing, then enable V-Pass and create test users.
set -euo pipefail
cd "$(dirname "$0")"

occ() { docker compose exec -T -u www-data nextcloud php occ "$@"; }

echo "Waiting for Nextcloud to finish installing…"
for _ in $(seq 1 120); do
	if occ status --output=json 2>/dev/null | grep -q '"installed":true'; then
		break
	fi
	sleep 3
done
occ status

occ config:system:set debug --value=true --type=boolean
occ config:system:set loglevel --value=0 --type=integer
occ app:enable vpass
# The welcome modal covers the page for every new user, including the e2e throwaway users.
occ app:disable firstrunwizard || true

for user in alice bob; do
	if ! occ user:info "$user" >/dev/null 2>&1; then
		docker compose exec -T -u www-data -e OC_PASS="${user}-vpass-dev" nextcloud php occ user:add --password-from-env "$user"
	fi
done

echo
echo "V-Pass dev instance ready: http://localhost:8080/apps/vpass/"
echo "Users: admin/admin, alice/alice-vpass-dev, bob/bob-vpass-dev"
