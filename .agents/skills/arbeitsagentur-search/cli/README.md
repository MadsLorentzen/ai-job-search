# arbeitsagentur-cli

CLI for the official **Bundesagentur für Arbeit Jobsuche API** — Germany's
government job portal and largest job board. Public API with a static key
(documented at https://jobsuche.api.bund.dev/), no registration, **zero runtime
dependencies** (plain `bun` + `fetch`).

## Install & run

```bash
bun install        # dev types only
bun run src/cli.ts search -q python -l Berlin --jobage 7 --format table
bun run src/cli.ts detail <refnr> --format plain
```

## Commands

See `../SKILL.md` for the full flag reference and usage examples, and
`../url-reference.md` for the API endpoint documentation.

## Test & typecheck

```bash
bun run test        # includes live smoke tests against the API
bun run typecheck
```
