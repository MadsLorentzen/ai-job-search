#!/usr/bin/env bash
# Tests for Bug #5 fix in .agents/skills/linkedin-search/cli/src/cli.ts
#
# Bug: parseInt(flags.jobage) returns NaN on bad input → !NaN is true → filter silently dropped.
# Fix: validate after parseInt, exit 1 with BAD_ARG error code on NaN.
#
# These tests do NOT actually hit LinkedIn — they only test CLI flag validation.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI_DIR="$REPO_ROOT/.agents/skills/linkedin-search/cli"
PASS="\033[92mPASS\033[0m"
FAIL="\033[91mFAIL\033[0m"

passed=0
failed=0
failures=()

check() {
  local name="$1"
  local condition="$2"
  if [ "$condition" -eq 1 ]; then
    echo -e "  [$PASS] $name"
    ((passed++)) || true
  else
    echo -e "  [$FAIL] $name"
    ((failed++)) || true
    failures+=("$name")
  fi
}

# Run the CLI, capture stdout+stderr separately
run_cli() {
  cd "$CLI_DIR"
  stdout=$(bun run src/cli.ts "$@" 2>/tmp/cli_stderr) || true
  stderr=$(cat /tmp/cli_stderr)
}

echo ""
echo "=== Bug #5: LinkedIn CLI --jobage / --page / --limit NaN validation ==="

# ---------------------------------------------------------------------------
# Test 1: --jobage with non-numeric string → exit 1 + BAD_ARG
# ---------------------------------------------------------------------------
echo ""
echo "Test 1: --jobage foo → should error with BAD_ARG"
run_cli search -l "Copenhagen, Denmark" --jobage foo
exit_code=0
cd "$CLI_DIR" && bun run src/cli.ts search -l "Copenhagen, Denmark" --jobage foo > /dev/null 2>/tmp/t1_stderr || exit_code=$?
t1_stderr=$(cat /tmp/t1_stderr)

check "exit code non-zero" $([ "$exit_code" -ne 0 ] && echo 1 || echo 0)
check "BAD_ARG code in stderr" $(echo "$t1_stderr" | grep -c '"code":"BAD_ARG"' || true)
check "error message mentions jobage" $(echo "$t1_stderr" | grep -c 'jobage' || true)

# ---------------------------------------------------------------------------
# Test 2: --page with non-numeric string → exit 1 + BAD_ARG
# ---------------------------------------------------------------------------
echo ""
echo "Test 2: --page abc → should error with BAD_ARG"
exit_code=0
cd "$CLI_DIR" && bun run src/cli.ts search -l "Copenhagen, Denmark" --page abc > /dev/null 2>/tmp/t2_stderr || exit_code=$?
t2_stderr=$(cat /tmp/t2_stderr)

check "exit code non-zero" $([ "$exit_code" -ne 0 ] && echo 1 || echo 0)
check "BAD_ARG code in stderr" $(echo "$t2_stderr" | grep -c '"code":"BAD_ARG"' || true)
check "error message mentions page" $(echo "$t2_stderr" | grep -c 'page' || true)

# ---------------------------------------------------------------------------
# Test 3: --limit with non-numeric string → exit 1 + BAD_ARG
# ---------------------------------------------------------------------------
echo ""
echo "Test 3: --limit xyz → should error with BAD_ARG"
exit_code=0
cd "$CLI_DIR" && bun run src/cli.ts search -l "Copenhagen, Denmark" --limit xyz > /dev/null 2>/tmp/t3_stderr || exit_code=$?
t3_stderr=$(cat /tmp/t3_stderr)

check "exit code non-zero" $([ "$exit_code" -ne 0 ] && echo 1 || echo 0)
check "BAD_ARG code in stderr" $(echo "$t3_stderr" | grep -c '"code":"BAD_ARG"' || true)
check "error message mentions limit" $(echo "$t3_stderr" | grep -c 'limit' || true)

# ---------------------------------------------------------------------------
# Test 4: --jobage with float string → parseInt still extracts int, no error
# ---------------------------------------------------------------------------
echo ""
echo "Test 4: --jobage 7.5 → parseInt extracts 7, no error (float truncation)"
exit_code=0
cd "$CLI_DIR" && bun run src/cli.ts search -l "Copenhagen, Denmark" --jobage 7.5 > /tmp/t4_stdout 2>/tmp/t4_stderr || exit_code=$?
t4_stderr=$(cat /tmp/t4_stderr)

# 7.5 → parseInt("7.5", 10) = 7 (valid), so no BAD_ARG
check "no BAD_ARG for float input" $(echo "$t4_stderr" | grep -c '"code":"BAD_ARG"' | awk '{print ($1==0)?1:0}')

# ---------------------------------------------------------------------------
# Test 5: --jobage with empty string via flag-only → should be boolean true, no parseInt called
# ---------------------------------------------------------------------------
echo ""
echo "Test 5: --jobage (no value, boolean true) → NaN path NOT triggered since flag is boolean"
# When --jobage has no following value, parseFlags sets flags.jobage = true (boolean)
# parseInt(true as string, 10) = parseInt("true", 10) = NaN — THIS IS ALSO A BUG EDGE CASE
# Our fix should catch it too
exit_code=0
cd "$CLI_DIR" && bun run src/cli.ts search -l "Copenhagen, Denmark" --jobage > /tmp/t5_stdout 2>/tmp/t5_stderr || exit_code=$?
t5_stderr=$(cat /tmp/t5_stderr)

check "exit non-zero for boolean --jobage" $([ "$exit_code" -ne 0 ] && echo 1 || echo 0)
check "BAD_ARG or error produced" $([ -n "$t5_stderr" ] && echo 1 || echo 0)

# ---------------------------------------------------------------------------
# Test 6: Valid numeric args pass through without error
# ---------------------------------------------------------------------------
echo ""
echo "Test 6: --jobage 7 --page 1 --limit 5 → valid, no BAD_ARG (will attempt network, that's fine)"
exit_code=0
cd "$CLI_DIR" && bun run src/cli.ts search -l "Copenhagen, Denmark" -q "test" --jobage 7 --page 1 --limit 5 > /tmp/t6_stdout 2>/tmp/t6_stderr || exit_code=$?
t6_stderr=$(cat /tmp/t6_stderr)

check "no BAD_ARG for valid inputs" $(echo "$t6_stderr" | grep -c '"code":"BAD_ARG"' | awk '{print ($1==0)?1:0}')

# ---------------------------------------------------------------------------
# Test 7: --jobage 0 → parseInt gives 0, which is falsy — verify it doesn't get default 9999
# ---------------------------------------------------------------------------
echo ""
echo "Test 7: --jobage 0 → edge: 0 is falsy in JS, check it is not treated as missing"
# After our fix, flags.jobage = "0" (stringified), then opts.jobage = parseInt("0", 10) = 0
# The ternary `flags.jobage ? parseInt(...) : 9999` — "0" is truthy as a string, so this is fine
exit_code=0
cd "$CLI_DIR" && bun run src/cli.ts search -l "Copenhagen, Denmark" --jobage 0 > /tmp/t7_stdout 2>/tmp/t7_stderr || exit_code=$?
t7_stderr=$(cat /tmp/t7_stderr)

check "no BAD_ARG for 0" $(echo "$t7_stderr" | grep -c '"code":"BAD_ARG"' | awk '{print ($1==0)?1:0}')

# ---------------------------------------------------------------------------
# Test 8: Missing --location still errors with NO_LOCATION (regression check)
# ---------------------------------------------------------------------------
echo ""
echo "Test 8: Missing --location → NO_LOCATION error (regression)"
exit_code=0
cd "$CLI_DIR" && bun run src/cli.ts search > /tmp/t8_stdout 2>/tmp/t8_stderr || exit_code=$?
t8_stderr=$(cat /tmp/t8_stderr)

check "exit code non-zero" $([ "$exit_code" -ne 0 ] && echo 1 || echo 0)
check "NO_LOCATION code in stderr" $(echo "$t8_stderr" | grep -c '"code":"NO_LOCATION"' || true)

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=================================================="
total=$((passed + failed))
echo "Results: $passed/$total passed"
if [ ${#failures[@]} -gt 0 ]; then
  echo "FAILED:"
  for f in "${failures[@]}"; do
    echo "  - $f"
  done
  exit 1
else
  echo "All green"
  exit 0
fi
