# AI Job Search — pi workspace

A role-bound pi agent runs this workspace; its identity is `.pi-agent/`.
This file is the catalog: it routes and holds nothing else.

## Where everything lives

| Path | Kind | Purpose |
| --- | --- | --- |
| `.pi-agent/` | agent | Policy (`SYSTEM.md`), settings, skills, extension tools |
| `profile/` | factory | Candidate facts, writing style, job-evaluation policy |
| `methods/` | factory | Pipeline contracts, numbered: `01-scrape` → `02-rank` → `03-apply` → `04-outcome`; setup/reset configure the factory |
| `postings/` | staging | Markdown snapshots of postings awaiting a decision |
| `applications/` | records | One folder per application: `posting.md`, `cv/`, `cover_letter/`, `outcome.md` |
| `research/` | records | Company research, salary data |
| `upskill/` | records | Learning notes |
| `state/` | machine | `seen_jobs.json`, `job_search_tracker.csv` — tool-written only |
| `factory/` | factory | LaTeX sources: master CV, cover class, OpenFonts |
| `documents/` | static | Diplomas, references, LinkedIn exports (never edited, only read) |
| `packages/tools/` | system | Bun/TS tooling + tests |
| `scripts/job.fish` | system | Launcher |

## Route by task

| Task | Read | Do |
| --- | --- | --- |
| Find jobs | `methods/01-scrape.md` + `.pi-agent/skills/job-scraper/` | scrape, then fetch-posting into `postings/` |
| Decide/shortlist | `methods/02-rank.md` | rank via `job_candidates` / rank-state |
| Apply | `methods/03-apply.md` | tailor from `factory/`, write to `applications/<company>_<role>/` |
| Record a result | `methods/04-outcome.md` | update tracker + `outcome.md` |
| Prep an interview | `methods/06-interview.md` | — |
| Onboard/reset | `methods/setup.md`, `methods/reset.md` | configure `profile/` |

## Launch

```fish
scripts/job.fish
```

Visiting coding agents: do not edit `.pi-agent/` policy, `profile/`, or
`methods/` without approval; follow this routing instead. Development:
`cd packages/tools && bun test`.
