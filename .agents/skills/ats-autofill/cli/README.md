# ats-autofill CLI

Prefills US job application forms from `application_profile.json`. **Never submits.**

## Install

```bash
bun install
bunx playwright install chromium
node --experimental-strip-types src/cli.ts doctor
```

`doctor` checks Playwright, the browser, and the profile file, and exits non-zero if anything is missing.

## Commands

| Command | Purpose |
|---------|---------|
| `fill <url>` | Fill the form and stop before submitting |
| `inspect <url>` | List fields and what each would be filled with (no page interaction) |
| `doctor` | Verify install and profile |

## Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `--profile, -p` | `<repo root>/application_profile.json` | Profile path |
| `--resume, -r` | profile value | Resume PDF to attach |
| `--cover, -c` | profile value | Cover letter PDF to attach |
| `--screenshot, -o` | `job_scraper/autofill_<ts>.png` | Screenshot destination |
| `--headed` | off | Show the browser and pause at the review gate. Recommended. |
| `--dry-run` | off | Report without filling |
| `--timeout` | `30000` | Navigation timeout in ms |
| `--format` | `json` (`table` for `inspect`) | Output format |

Headed review uses `StdinReviewGate` (Enter continues, stdin close cancels) unless Desk set `JOB_SEARCH_DESK_REVIEW_URL`. Then `DeskReviewGate` posts browser-ready and waits for Continue or Cancel. Neither adapter can submit.

## Exit codes

`0` success. `1` with a JSON error object on stderr for: `NO_URL`, `BAD_URL`, `BAD_PROFILE`, `MISSING_DOCUMENT`, `BAD_ARG`, `BAD_CMD`, `FILL_FAILED`.

## Tests

```bash
bun test        # matching logic, offline, no browser needed
bun run typecheck
```

The tests cover work-authorization polarity, identity mapping, rule precedence, the never-volunteer-salary rule, and decline-to-self-identify option matching across vendor phrasings. Add a case here before changing `src/matcher.ts`.
