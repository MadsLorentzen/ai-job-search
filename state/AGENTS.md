# State — machine state

`seen_jobs.json` (dedup backlog) and `job_search_tracker.csv` (applications).

Never read into conversation to filter by eye, never hand-edited, never
restructured field-wise (see `methods/02-rank.md` rules). All reads and writes
go through the tools: the `job_candidates` / `job_rank_apply` extension tools
or `bun run packages/tools/src/cli.ts rank-state|job-key …`.

Status of the whole search is derivable by scanning these plus
`applications/` — there is no separate dashboard to maintain.
