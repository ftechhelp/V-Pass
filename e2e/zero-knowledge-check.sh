#!/usr/bin/env bash
# Store a unique sentinel string as a password, a note and a file through the real
# API, then search the PostgreSQL dump and Nextcloud's data folder for it.
# Any match means plaintext reached the server, and the check fails.
set -euo pipefail
cd "$(dirname "$0")/.."
VPASS_ZK_CHECK=1 npx vitest run -c e2e/vitest.config.ts
echo "Zero-knowledge check passed: no plaintext found in the database or data folder."
