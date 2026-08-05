# usajobs-cli

CLI for searching [USAJOBS](https://www.usajobs.gov), the official US federal
government job board. Zero runtime dependencies — plain `bun` + `fetch`.

## Setup: a free API key is required

This is the only authenticating portal in the fork. Without credentials every
request returns HTTP 401.

Register (free): <https://developer.usajobs.gov/apirequest/>

Then put both values in **`.env` at the REPO ROOT** — not in this folder:

```dotenv
USAJOBS_API_KEY=<key from the confirmation email>
USAJOBS_EMAIL=<the email you registered>
```

Bun auto-loads `.env` from the working directory, and the skill runs from the repo
root, so a `.env` in this `cli/` folder is silently ignored. `.env` is gitignored.

The registered email is sent as the `User-Agent` header — a mismatch 401s exactly
like a wrong key.

Then flip `enabled: false` → `true` in `../SKILL.md` so `/scrape` picks it up.

## Install

```bash
bun install   # dev types only (typescript, @types/bun)
```

## Usage

```bash
bun run src/cli.ts search -q "data scientist" --remote --format table
bun run src/cli.ts detail 828810900 --format plain
```

Run `bun run src/cli.ts --help` for the full flag list.

## Everything is server-side

Unlike the other portals here, USAJOBS filters keyword, title, location, agency,
remote and recency in the API. Two caps worth knowing: `DatePosted` maxes at 60
days (clamped, not rejected) and `ResultsPerPage` at 500.

## Verification status

Request wiring is verified live — a bad key produces a real 401 that the CLI
translates into an actionable message. **Response parsing is not yet verified
against live data** (that needs a real key); it is built to the published schema
and unit-tested against it. Sanity-check your first real `search` output.

## Tests

```bash
bun run typecheck
bun test
```

Offline suite. The flag-validation tests deliberately run without credentials,
which also pins the ordering guarantee: a bad flag reports as `BAD_ARG`, not as
`NO_CREDENTIALS`.
