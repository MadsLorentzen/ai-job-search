# jsearch-cli

Command-line client for the JSearch API (Google for Jobs data via RapidAPI). Zero runtime
dependencies; `bun install` only pulls TypeScript types for `typecheck`.

```bash
export JSEARCH_API_TOKEN="<your RapidAPI key>"   # keep it out of the repo
bun run src/cli.ts search -q "data engineer" -l "Dublin, Ireland" --country ie --jobage 7 --format table
bun run test        # offline tests; set JSEARCH_LIVE_TEST=1 to add one billed live search
bun run typecheck
```

Every `search` and `detail` call is one billed request. See `../SKILL.md` for flags,
output fields and error codes, and `../url-reference.md` for the API mapping.
