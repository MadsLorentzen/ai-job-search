---
name: artstation-search
version: 1.0.0
description: >
  Use this skill to search live game / 3D / VFX / concept-art job listings on
  ArtStation Jobs (artstation.com/jobs), or to look up a specific posting. Global
  coverage across studios that recruit via ArtStation, spanning games, film/VFX,
  animation, and illustration. Trigger phrases: find a 3D artist job, game art job
  search, environment artist jobs, hard surface artist jobs, character artist jobs,
  concept artist jobs, VFX artist jobs, "are there any <art role> jobs", look up
  this ArtStation job posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/artstation-search/cli/src/cli.ts *)
---

# ArtStation Jobs Search Skill

Search live job listings from **[ArtStation Jobs](https://www.artstation.com/jobs)**
— the job board built into ArtStation, the leading portfolio platform for game,
3D, VFX, and concept artists. No authentication, no API key, and **zero runtime
dependencies** — it runs with just `bun`.

> This is a worked example of the repo's job-portal-skill pattern, like
> `linkedin-search` and `freehire-search`. Like freehire, it queries a public
> JSON API rather than scraping HTML — the endpoint was found by watching live
> network requests from the ArtStation Jobs Angular app (its minified JS bundles
> do not expose the endpoint via static string search; it's built at runtime).

## When to use this skill

- Search for game/3D/VFX/concept-art job openings by keyword
- Look up a specific ArtStation posting by its job id
- Best signal for art-specific roles (environment, prop, character, hard-surface,
  concept, VFX) — narrower and more relevant than general-purpose boards for this field

## Commands

### Search job listings

```bash
bun run .agents/skills/artstation-search/cli/src/cli.ts search [-q "<keywords>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, skill, role). Optional; omit for all jobs.
- `--jobage <days>` — posted within N days. **Filtered client-side** against each
  posting's `created_at` — the API itself has no server-side date parameter.
- `--page <n>` — 1-indexed page. Default 1.
- `--limit <n>` / `-n <n>` — results per page / cap (client-side). Default 20.
- `--format json|table|plain` — default `json`.

**No location filter yet.** ArtStation's web UI has a Location dropdown, but its
query-param wiring wasn't identified during scaffolding — this skill searches by
keyword only. Each result still carries `location` (joined from the posting's
recruitment localities) and `remote` (boolean) so you can filter the output
yourself; `/scrape` should treat this portal as keyword-only and rely on the
result's `location`/`remote` fields for geographic relevance.

### Fetch full job detail

```bash
bun run .agents/skills/artstation-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the job's `hash_id` from a `search` result's `id` field (e.g. `aNba`). You
may also pass a full `https://www.artstation.com/jobs/<id>` URL. Returns the full
HTML-stripped description, salary (when the poster set one), skills, remote/
relocation flags, and the employer's own `applyUrl` (ArtStation itself is not an
ATS — postings link out to the studio's application page).

## Usage examples

```bash
# Environment artist roles, table view
bun run .agents/skills/artstation-search/cli/src/cli.ts search -q "Environment Artist" --format table

# Props artist roles posted in the last 14 days
bun run .agents/skills/artstation-search/cli/src/cli.ts search -q "3D Props Artist" --jobage 14 --format table

# Hard surface artist roles
bun run .agents/skills/artstation-search/cli/src/cli.ts search -q "Hard Surface Artist" --limit 10 --format table

# Full detail for a specific job
bun run .agents/skills/artstation-search/cli/src/cli.ts detail aNba --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing ids to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page", "total" }, "results": [...] }`; each
result carries `id` (the ArtStation `hash_id`), `title`, `company`, `location`
(`null` if the poster set none), `date`, `url`, `remote`, `level`, `job_type`. All
errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

## Notes

- Data is from ArtStation's public jobs API — no credentials required.
- `robots.txt` does not disallow `/jobs` or `/api` paths as of 2026-07-31.
- The search API rejects `per_page < 3` — the CLI always requests at least 3 and
  trims to `--limit` client-side, so this never surfaces as a user-facing error.
- `id` in search results is the `hash_id` — pass it as-is to `detail`.
- `date` is the posting's `created_at`; results appear to arrive newest-first by
  default, but this isn't a documented guarantee.
- Retries 429/5xx with exponential backoff; an unreachable API exits non-zero with
  a clear message rather than hanging.
- Query behavior can be literal/exact-phrase-ish — a very specific multi-word title
  (e.g. `"3D Props Artist"` verbatim) can return zero results even when related
  roles exist. Prefer 1-2 broad keywords (e.g. `"Environment Artist"`, `"Props"`)
  over an exact job title when a specific search comes back empty.
