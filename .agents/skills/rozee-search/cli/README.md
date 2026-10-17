# Rozee Search CLI

Personal-use CLI for searching public job listings on Rozee.pk. It uses Bun's
built-in `fetch` and has no runtime dependencies.

```bash
bun run src/cli.ts search -q "Machine Learning Intern" -l Islamabad --limit 10 --format table
bun run src/cli.ts detail "machine-learning-intern-islamabad-jobs-123456" --format plain
```

Search supports mapped city filters, pagination, and a client-side limit. Rozee
does not expose a posting-age or remote-work filter on the observed public
search route. Automated use is not confirmed by the accessible terms; use only
for low-volume personal searching, and do not redistribute listing content.

```bash
bun install
bun run typecheck
bun run test
```

The live portal smoke test is skipped by default. To opt into one low-volume
live search and detail fetch, set `ROZEE_LIVE_TEST=1` before running
`bun test tests/live-smoke.test.ts`.
