# indeed-cli

Command-line client for Indeed job search through the Apify actor misceres/indeed-scraper. Zero runtime dependencies; `bun install` only pulls TypeScript types.

```bash
export APIFY_API_TOKEN="<your Apify token>"   # keep it out of the repo
bun run src/cli.ts search -q "data engineer" -l "Dublin" --jobage 7 -n 10 --max-charge 0.20 --format table
bun run test        # offline; set INDEED_LIVE_TEST=1 to add one billed live run (capped at $0.10)
bun run typecheck
```

Every run is billed to your Apify account and capped by `--max-charge`. Personal use only (Indeed ToS). See `../SKILL.md` and `../url-reference.md`.
