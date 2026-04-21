#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm ci
./node_modules/.bin/tsx scripts/setup-local.ts --yes "$@"
npm run build

printf '\nUnpacked extension path: %s/packages/extension/dist\n' "$ROOT"
printf 'Proxy will start now. Press Ctrl+C to stop it.\n'
exec npm run dev:proxy
