# Job portals for this fork

Upstream ships four **Danish demonstration** boards plus two country-agnostic CLIs (`linkedin-search`, `freehire-search`). This fork adds two more generic CLIs and a recipe book so you can cover India, the US, Europe, and elsewhere **without** dumping country-specific scrapers into a PR.

**Rule:** market-specific skills (Naukri, Indeed.de, Jobindex, …) live in *your* clone. Generic tools and `/add-portal` stay shareable.

## What to run first (non-Danish users)

| Priority | Skill | Why | ToS / access |
|----------|--------|-----|----------------|
| 1 | `linkedin-search` | Best generic coverage; pass `--location` for any city | Personal use only, keep volume low |
| 2 | `freehire-search` | Public JSON API, tech-focused, multi-market | MIT aggregator; optional self-host |
| 3 | `ats-boards-search` | Greenhouse / Lever / Ashby company pages (huge share of tech jobs) | Public JSON; no key |
| 4 | `rss-search` | Employer RSS/Atom feeds | Public XML |
| 5 | `/add-portal` | Your local board (Naukri, Stepstone, Seek, …) | Follow robots.txt + terms |

Danish demo skills (`jobindex-search`, `jobnet-search`, `jobbank-search`, `jobdanmark-search`) can stay installed. Set `enabled: false` in each `SKILL.md` if you do not want `/scrape` to query Denmark.

## Recommended portals by region

These are **starting points**, not scrapers in this repo.

| Region | Start with | Then add (in your fork) |
|--------|------------|-------------------------|
| Anywhere | LinkedIn (`-l "City, Country"` or `Remote`) | Company Greenhouse/Lever/Ashby boards |
| India | LinkedIn `-l "Bengaluru, Karnataka, India"` (or Hyderabad, Pune, Mumbai, Remote) | Naukri / Instahyre via `/add-portal` if public pages allow; company ATS boards |
| United States | LinkedIn + Greenhouse/Lever/Ashby | Indeed only with extreme care (ToS); company career RSS |
| UK / Ireland | LinkedIn | Reed, Totaljobs via `/add-portal` if public |
| EU (non-DK) | LinkedIn + freehire `--region eu` | Stepstone, Welcome to the Jungle, local public boards via `/add-portal` |
| Remote-first | LinkedIn `-l Remote` + freehire `--remote` | ATS boards with `Remote` location filter |

## Generic CLIs shipped here

### LinkedIn (`linkedin-search`) — primary

```bash
bun run .agents/skills/linkedin-search/cli/src/cli.ts search -q "data engineer" -l "Bengaluru, Karnataka, India" --jobage 14 --format table
```

Personal use only (LinkedIn ToS). `/scrape` already discovers this skill.

### freehire (`freehire-search`)

```bash
bun run .agents/skills/freehire-search/cli/src/cli.ts search -q "backend" --region eu --format table
```

### ATS boards (`ats-boards-search`) — opt-in

1. Copy `.agents/skills/ats-boards-search/boards.example.json` to `job_scraper/ats_boards.json`
2. Replace tokens with companies you follow (`greenhouse:stripe`, `lever:netflix`, `ashby:openai`)
3. Set `enabled: true` in `.agents/skills/ats-boards-search/SKILL.md`

```bash
bun run .agents/skills/ats-boards-search/cli/src/cli.ts search --boards-file job_scraper/ats_boards.json -q "engineer" --format table
```

### RSS (`rss-search`) — opt-in

Same pattern with `.agents/skills/rss-search/feeds.example.json` → `job_scraper/rss_feeds.json`.

## Portal recipes (`/add-portal`)

`/add-portal` remains the way to add Naukri, Indeed (if you accept the ToS risk), Stepstone, Seek, etc. Use `linkedin-search` as the architecture reference.

Before scaffolding, `/add-portal` must still: fetch robots.txt, refuse login walls, and put a personal-use warning on restrictive terms.

### Greenhouse / Lever / Ashby (prefer the shipped CLI)

Do **not** scrape the HTML career page. Use `ats-boards-search` with the board token from the public URL.

### Indeed

Indeed is ToS-restricted and heavily bot-protected. `/add-portal` should usually **stop** and recommend LinkedIn + company ATS boards instead. If you still proceed for personal use, the generated `SKILL.md` must carry a personal-use-only warning and you must keep volume tiny. There is no shipped Indeed scraper in this fork on purpose.

### Naukri, LinkedIn India filters, and other national boards

Stay in this fork. Typical `/add-portal` interview:

1. Portal URL (e.g. `https://www.naukri.com`)
2. Skill name `naukri-search`
3. Market: India / English + local terms in the trigger phrases
4. Test query you would actually run

If the portal needs a paid unlocker, `/add-portal` already explains the credential path (`<SERVICE>_API_TOKEN`). Prefer not to.

### Workday

Workday tenant pages are company-specific and often script-heavy. Prefer the company's Greenhouse/Lever/Ashby board if they have one. Otherwise paste the posting into `/apply` or drop text in `documents/postings/`.

## Disable Danish demos

In each Danish skill's `SKILL.md` frontmatter:

```yaml
enabled: false
```

`/scrape` then skips them and reports `skipped (disabled): ...`.
