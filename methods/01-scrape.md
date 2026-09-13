# 01 — Scrape

Stage 1 of the pipeline: find postings and archive them as markdown.

1. Read `.pi-agent/skills/job-scraper/SKILL.md` — the portal CLIs, dedup
   against `state/seen_jobs.json`, and the tracker exclusion live there.
2. For every new candidate worth a look, snapshot it:

   ```bash
   bun run packages/tools/src/cli.ts fetch-posting <url> \
     --company "<company>" --title "<title>"
   ```

   → defuddle extracts (JSON), knap renders `_templates/posting.md`, and the
   tool writes `postings/<job_key>.md` with pipeline frontmatter (`url`,
   `fetched_at`, `job_key`, `portal`). The snapshot is the evidence every later
   stage reads; never paste posting text into conversation when a snapshot
   can exist instead.
3. Leave ranking to `02-rank.md`. This stage only acquires.

Inputs: profile search queries, portal skills, `state/seen_jobs.json`.
Outputs: new `postings/*.md`, updated `state/seen_jobs.json` (via scrape skill).
Human check: skim the scrape digest before ranking.
