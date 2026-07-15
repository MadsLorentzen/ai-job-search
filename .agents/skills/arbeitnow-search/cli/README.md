# arbeitnow-cli

CLI for the free **Arbeitnow job board API** — jobs in Germany with a
tech/startup/English-speaking focus. No API key, no registration, **zero runtime
dependencies** (plain `bun` + `fetch`).

The API ignores server-side filter parameters, so this CLI fetches pages
(100 jobs each) and filters client-side. See `../url-reference.md`.

## Install & run

```bash
bun install        # dev types only
bun run src/cli.ts search -q developer --remote --format table
bun run src/cli.ts detail <slug> --format plain
```

## Test & typecheck

```bash
bun run test        # includes live smoke tests against the API
bun run typecheck
```
