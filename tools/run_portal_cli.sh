#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 1 ]]; then
  echo "Usage: tools/run_portal_cli.sh <portal-skill> [cli args...]"
  echo "Example: tools/run_portal_cli.sh linkedin-search search -q 'Engineering Manager' -l 'Berlin, Germany' --format table"
  exit 2
fi

tool="$1"
shift

cli=".agents/skills/${tool}/cli/src/cli.ts"
if [[ ! -f "$cli" ]]; then
  echo "Unknown portal skill or missing CLI: $cli" >&2
  exit 1
fi

command_parts=(bun run "$cli" "$@")
printf -v command_string " %q" "${command_parts[@]}"
docker compose run --rm --user "$(id -u):$(id -g)" bun "${command_string:1}"
