#!/bin/sh
# Nextcloud's PHP 8.5 runtime must include the 2026-10-21 security fixes.
set -eu
cd "$(dirname "$0")/.."
docker compose -f dev/docker-compose.yml exec -T nextcloud php -r '
    if (PHP_VERSION_ID < 80512) {
        fwrite(STDERR, "FAIL: PHP " . PHP_VERSION . "; require PHP 8.5.12 or newer.\n");
        exit(1);
    }
    echo "PASS: Nextcloud runtime PHP " . PHP_VERSION . "\n";
'
