#!/usr/bin/env bash
set -euo pipefail

missing=0

check() {
  local command="$1"
  local purpose="$2"

  if command -v "$command" >/dev/null 2>&1; then
    printf '%-14s ok       %s\n' "$command" "$purpose"
  else
    printf '%-14s missing  %s\n' "$command" "$purpose"
    missing=1
  fi
}

echo "Project dependency check"
echo
check docker "runs the project-local Compose toolchain"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  printf '%-14s ok       %s\n' "docker compose" "runs latex and bun containers"
else
  printf '%-14s missing  %s\n' "docker compose" "runs latex and bun containers"
  missing=1
fi

echo
if [[ "$missing" -ne 0 ]]; then
  echo "Missing required host dependency: Docker with Compose."
  echo "All LaTeX and Bun tooling runs inside containers from compose.yml."
  exit 1
fi

echo "Host is ready. Tooling is provided by compose.yml."
