---
name: freelance-informatique-search
version: 1.0.0
description: >
  Use this skill to search live freelance IT missions in France on
  Freelance-Informatique (www.freelance-informatique.fr), one of the oldest
  French IT contracting boards — ~700 active missions, every one of them a
  freelance mission (no CDI, no CDD, no stage, no alternance), mostly posted by
  ESN and grands comptes with durations of 3 to 12 months. Filterable by skill,
  by location (department, city, Île-de-France, or télétravail) and by posting
  age, and it returns the start date, duration and required skills of each
  mission. Trigger phrases: mission freelance, missions freelance informatique,
  freelance informatique, offres freelance, recherche de mission, mission
  backend Paris, mission développeur Île-de-France, mission en télétravail,
  Freelance-Informatique, French freelance IT missions, contract role France,
  look up this Freelance-Informatique mission.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/freelance-informatique-search/cli/src/cli.ts *)
---

# Freelance-Informatique Search Skill

Search live freelance missions from
**[Freelance-Informatique](https://www.freelance-informatique.fr)** — a French
IT contracting board where **100% of listings are freelance missions**. That
makes it complementary to the generalist boards in this repo: Welcome to the
Jungle and HelloWork carry mostly CDI, and freelance postings are a rounding
error there.

The CLI parses the portal's public HTML pages. No authentication, no API key,
and **zero runtime dependencies** — it runs with just `bun`.

## Access and fair use

The portal's `robots.txt` disallows only `/forum/`, `/forum-freelance/`,
`/fr/freelance/`, `/fr/entreprises/`, `/fr/admin/`, and any `.php` or `.asp`
path. The mission paths this skill uses — `/offres-freelance` and
`/mission-*` — are permitted, and both answer unauthenticated GETs. There is no
ToS-restriction warning to carry here, unlike `linkedin-search`.

The two `.php` endpoints that back the site's own search widgets
(`/_recherche-competences.php` for skill autocomplete and
`/sites/liste-localisations.php` for the location dropdown) **are**
robots-disallowed, so this skill does not touch them. That is the direct cause
of the `--location` limitation below.

Even so, this is a personal job-search tool: keep request volume modest and do
not use it for bulk data collection.

## What this portal does and does not publish

| Field | Available |
|---|---|
| Start date, duration, renewability | ✅ on nearly every mission |
| Required vs. optional skills | ✅ tagged, `detail` separates them |
| Location (department + city, or "Télétravail") | ✅ |
| Sector and profile family | ✅ on `detail` |
| **TJM / daily rate** | ❌ **never published** — `dailyRate` is always `null` |
| **Client name** | ❌ anonymised behind a generic logo — `company` is always `null` |

**If you need a TJM, use `free-work-search` instead** — it publishes a daily
rate on roughly half its postings. Use this skill for mission *volume* and for
the start-date / duration / skills detail, and treat rate as a conversation to
have with the intermediary.

## When to use this skill

- Find freelance IT missions in France, especially long ESN/grand-compte missions
- Filter missions by department, city, Île-de-France, or full remote
- See which skills a mission marks as mandatory versus nice-to-have
- Get the full description of a specific Freelance-Informatique mission

## Commands

```bash
bun run .agents/skills/freelance-informatique-search/cli/src/cli.ts search [flags]
bun run .agents/skills/freelance-informatique-search/cli/src/cli.ts detail <ref|url> [--format json|plain]
```

### Search flags

| Flag | Meaning |
|---|---|
| `--query`, `-q <text>` | Skill or technology. Matched against the portal's **skills taxonomy**, not full text — see Notes. |
| `--location`, `-l <place>` | **Client-side** filter. Department (`75`), city (`Bordeaux`), `idf` / `ile-de-france`, or `remote` / `teletravail`. |
| `--jobage <days>` | Posted within N days. **Client-side** — the portal has no date parameter. |
| `--page <n>` | 1-indexed page, 50 missions per page. Default 1. |
| `--limit`, `-n <n>` | Cap results emitted (client-side, applied last). |
| `--strict` | Keep only missions actually tagged with `--query`. Use it whenever the term may sit outside the portal's taxonomy — see the substitution quirk below. |
| `--format <fmt>` | `json` (default) \| `table` \| `plain`. |

### Examples

```bash
# Node.js missions, scannable
bun run .agents/skills/freelance-informatique-search/cli/src/cli.ts \
  search -q "Node.js" --format table

# Java missions in Île-de-France posted in the last week
bun run .agents/skills/freelance-informatique-search/cli/src/cli.ts \
  search -q "Java" -l idf --jobage 7 --format table

# A term that may be outside the taxonomy — --strict refuses substitutions
bun run .agents/skills/freelance-informatique-search/cli/src/cli.ts \
  search -q "Rust" --strict --format table

# Full-remote Kubernetes missions
bun run .agents/skills/freelance-informatique-search/cli/src/cli.ts \
  search -q "Kubernetes" -l remote --format plain

# PostgreSQL missions in Hauts-de-Seine, capped at 10
bun run .agents/skills/freelance-informatique-search/cli/src/cli.ts \
  search -q "PostgreSQL" -l 92 -n 10

# Browse everything, second page
bun run .agents/skills/freelance-informatique-search/cli/src/cli.ts \
  search --page 2 --format table

# Full description of one mission
bun run .agents/skills/freelance-informatique-search/cli/src/cli.ts \
  detail 260728C015 --format plain
```

## Output format

`--format json` (default) follows the repo's portal-skill contract:

```json
{
  "meta": { "count": 1, "page": 1, "fetchedOnPage": 3, "filteredClientSide": 2, "querySkillHits": 3 },
  "results": [
    {
      "id": "260727C007",
      "title": "Développeur Angular, NodesJS",
      "company": null,
      "location": "44 - Nantes",
      "department": "44",
      "date": "2026-07-27",
      "dateRaw": "Publiée il y a 2 jours",
      "url": "https://www.freelance-informatique.fr/mission-developpeur-angular-nodesjs-sur-nantes-260727C007",
      "startDate": "2026-08-01",
      "duration": "6 mois",
      "skills": ["Angular", "Node.js", "TypeScript"],
      "excerpt": "Dev - Angular Node.js TypeScript ...",
      "dailyRate": null
    }
  ]
}
```

`detail` adds `description`, `profile`, `sector`, `requiredSkills`,
`optionalSkills` and `applyUrl`. Missing values are `null`, never omitted.
Errors go to **stderr** as `{"error": "...", "code": "..."}` with exit code 1.

`meta.querySkillHits` is how many of the fetched missions are genuinely tagged
with `--query` (`null` when no query was passed). **A count of 0 alongside a
non-empty result set means the portal substituted a related skill** — see the
quirks below. `meta.fetchedOnPage` and `meta.filteredClientSide` show how much
of the page the client-side filters removed — if `filteredClientSide` is close to
`fetchedOnPage`, widen `--jobage`/`--location` or advance `--page`.

| Format | Use |
|---|---|
| `json` | Default. Machine-readable, full field set. |
| `table` | One line per mission: id, title, location, duration, start, posted. |
| `plain` | Human-readable blocks including skills and the raw French posting age. |

## Notes and portal quirks

- **`--query` searches the skills taxonomy, not free text.** `competences=` is
  matched against the skill tags attached to each mission, and the portal
  normalises them (`Node.js` and `NodeJS` return the same 3 missions). Search
  for a *technology* (`Java`, `Kubernetes`, `PostgreSQL`), not for a phrase —
  `"développeur backend senior"` returns nothing useful.
- **⚠️ A term outside the taxonomy is silently swapped for a related one.**
  This is the single easiest way to get plausible-looking but wrong output from
  this portal. `-q "Rust"` returns **seven C++ missions, none of them tagged
  Rust** — the portal widens to a neighbouring skill instead of returning
  nothing. Some absent terms (`NestJS`, `Golang`) do return zero, so an empty
  result is not the reliable signal either. The CLI detects this: when no
  mission on the page carries the queried tag it writes a
  `QUERY_SUBSTITUTED` warning to **stderr** and reports `meta.querySkillHits: 0`,
  and `--strict` drops the substituted rows. **Never read a result set from this
  portal as evidence for a technology without checking `querySkillHits`.**
  Verified absent from the taxonomy as of 2026-07-29: `Rust` (→ C++),
  `NestJS` (→ 0), `Golang` (→ 0, but bare `Go` matches a real `GO` tag).
- **`--location` is applied client-side.** The site's own location dropdown
  posts an opaque id fetched from `/sites/liste-localisations.php`, which
  `robots.txt` disallows; passing a plain city or department to `localisation=`
  is silently ignored by the server and returns unfiltered results. The CLI
  therefore filters the parsed cards instead, on the mission's `"75 - Paris"`
  string. Consequence: **it only sees the 50 missions on the requested page** —
  narrow with `--query` first, or walk `--page`.
- **`--jobage` is also client-side**, for the same reason: no date parameter
  exists. Results are already newest-first, so a small `--jobage` on page 1 is
  cheap and accurate.
- **Mission links are randomly obfuscated.** The same card is served sometimes
  as `<a href="/mission-...">` and sometimes as a `<span data-obf="<base64>">`
  holding the path. The parser handles both; a card in either form yields the
  same `id` and `url`.
- **`detail` never needs the slug.** The portal 301-redirects
  `/mission-<anything>-<REF>` to the canonical URL, so the CLI resolves a bare
  reference like `260728C015` in one request. It accepts a reference, a path, or
  a full URL.
- **A bogus reference returns HTTP 200, not 404.** The portal serves a generic
  page for unknown references; the CLI detects the missing `<h1 class="title">`
  and `Ref :` anchors and reports `NOT_FOUND` rather than emitting a hollow
  record.
- **Posting dates are relative and need a reference date.** Cards say
  `Publiée à l'instant` / `aujourd'hui` / `hier` / `il y a N jours` for recent
  missions and switch to `Publiée le DD/MM` — with no year — beyond about a
  week. The CLI resolves these to ISO in `date` and keeps the original wording
  in `dateRaw`; a `DD/MM` that would land in the future is read as last year.
- **Encoding is mixed.** Descriptions are mostly raw UTF-8 but contain named
  entities (`&eacute;`) and, frequently, semicolon-less ones (`&nbsp`, `&gt`,
  `&amp`). The decoder handles both forms.

See `url-reference.md` for full endpoint documentation and the parsing anchors.
