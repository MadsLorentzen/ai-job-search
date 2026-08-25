#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v bun >/dev/null 2>&1; then
  exec bun gui/server.mjs "$@"
fi

if command -v node >/dev/null 2>&1; then
  exec node gui/server.mjs "$@"
fi

echo "Need bun or node on PATH, or install the Job Search Desk app from Releases." >&2
exit 1
