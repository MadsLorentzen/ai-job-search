<p align="center">
  <img src="claude_animation.gif" alt="Claude Flat Search Assistant" width="200">
</p>

# AI Flat Search

An AI-powered flat-hunting framework built on [Claude Code](https://claude.com/claude-code), forked from [Mads Lorentzen's ai-job-search](https://github.com/MadsLorentzen/ai-job-search) and repurposed for apartment hunting in Germany. Fill in your profile, and let Claude evaluate listings, keep your Mieterselbstauskunft current, draft Anschreiben to landlords, and prep you for viewings.

## What this is

The job-search and flat-search problems turn out to be nearly the same shape: a structured profile, fast-moving listings that need triage, and a tailored message that has to reference specifics instead of reading as a template. This fork keeps the original three-command workflow (`/setup` → `/scrape` → `/apply`) and re-skins every document and evaluation step for renting instead of hiring.

```
/setup          /scrape              /apply
  |                |                   |
  v                v                   v
Fill in        Search Kleinanzeigen  Evaluate fit
your profile   + WG-Gesucht etc.     Score commute/price/area
  |                |                   |
  v                v                   v
Profile        Present matches      Draft Selbstauskunft
files ready    with fit ratings     + Anschreiben (LaTeX)
                   |                   |
                   v                   v
               Pick a match         Reviewer agent checks
               -> /apply            for scams + generic phrasing
                                     -> Revise -> Final output
                                     (you send it yourself)
```

This instance is configured for a specific search: **Köln rechtsrheinisch** — Stadtbezirke **Mülheim / Kalk / Porz** (PLZ-Whitelist im Skill), **max. 1.200 € Warmmiete**, **Balkon Pflicht**, kein aktueller Arbeitsort (ÖPNV-Anschluss Köln Hbf ist ein Plus). Suchpräferenz-Kaskade: (1) eigene Wohnung → (2) WG-Zimmer (max 3–4 Mitbewohner) → (3) Hausgemeinschaft/Cohousing. Change `CLAUDE.md` and `.claude/skills/flat-scraper/search-criteria.md` to point this at a different city, budget, or workplace.

## What makes this different from a generic listing alert

- **It drafts, it never sends.** No portal login, no auto-submitted inquiry forms, no messaging API. `/apply` produces a PDF Selbstauskunft and Anschreiben for you to review and send yourself.
- **No anti-bot evasion.** ImmoScout24 has aggressive Cloudflare protection; this framework does not try to defeat it. It uses `WebSearch`/`WebFetch` only, the same as you fetching a page in a browser tab — fetches there will sometimes just fail, and that's the expected outcome rather than something to route around.
- **Every Anschreiben must reference a real detail from the listing.** The biggest failure mode in rental inquiries is a generic copy-paste message buried in 100+ identical ones. The writing-style rules (`03-writing-style.md`) make a specific listing detail mandatory, not optional.
- **Scam awareness is built in.** `07-besichtigung-prep.md` lists the common rental-scam patterns (pay-before-viewing, "landlord is abroad," below-market pricing), and both `/scrape` and `/apply` check for them before doing anything else with a listing.

## Prerequisites

- [Claude Code](https://claude.com/claude-code) (CLI)
- LaTeX distribution with `lualatex` and `xelatex`: [TeX Live](https://tug.org/texlive/) or [MiKTeX](https://miktex.org/). The Selbstauskunft compiles with `lualatex`; the Anschreiben compiles with `xelatex` because `cover.cls` requires `fontspec` for its custom Lato/Raleway fonts.

## Quick start

### 1. Set up your profile

```bash
claude
# Then inside Claude Code:
/setup
```

`/setup` offers three paths: read your `documents/` folder if you have it populated (income proof, employer letter, Schufa, landlord references, past inquiries), paste your details directly in chat, or walk through an interview. The search criteria (target areas, budget, workplace) are already pre-filled from this fork's configuration — setup mainly fills in your personal facts and confirms the commute tolerance.

### 2. Search for listings

```bash
/scrape
```

This searches Kleinanzeigen and WG-Gesucht (primary), Immowelt (secondary), and ImmoScout24 (best-effort), deduplicates results, and presents them sorted by fit. Pick a match to run `/apply` on it directly.

### 3. Inquire about a listing

```bash
/apply https://www.kleinanzeigen.de/s-anzeige/...
```

If the URL can't be fetched (ImmoScout24 in particular often blocks automated access), paste the listing text directly instead:

```bash
/apply <paste the full listing text here>
```

This runs the full workflow: evaluate fit, check for scam red flags, draft a Mieterselbstauskunft + Anschreiben, review with a second agent, revise, and present the final PDFs. **You send the inquiry yourself** — nothing is submitted automatically.

## Other commands

`/reset` wipes profile data or the documents folder, see [Starting over](#starting-over) below.

## File structure

```
ai-flat-search/
├── CLAUDE.md                              # Renter profile + workflow rules
├── .claude/
│   ├── commands/
│   │   ├── apply.md                       # /apply workflow (drafter-reviewer)
│   │   ├── setup.md                       # /setup onboarding
│   │   └── reset.md                       # /reset wipe profile data or documents folder
│   ├── skills/
│   │   ├── flat-application-assistant/    # Core inquiry skill
│   │   │   ├── SKILL.md                   # Skill definition
│   │   │   ├── 01-renter-profile.md       # Identity, household, employment, income
│   │   │   ├── 02-tenant-profile.md       # Tenant persona, selling points
│   │   │   ├── 03-writing-style.md        # Tone, structure, do's and don'ts for Anschreiben
│   │   │   ├── 04-flat-evaluation.md      # Scoring framework for listing fit
│   │   │   ├── 05-selbstauskunft-templates.md  # LaTeX Selbstauskunft structure
│   │   │   ├── 06-anschreiben-templates.md     # LaTeX Anschreiben structure
│   │   │   └── 07-besichtigung-prep.md    # Viewing prep, questions, scam red flags
│   │   └── flat-scraper/                  # Listing search orchestration
│   └── settings.local.json                # Claude Code permissions
├── selbstauskunft/
│   └── selbstauskunft_example.tex         # Mieterselbstauskunft LaTeX template
├── anschreiben/
│   ├── cover.cls                          # Custom letter LaTeX class
│   └── OpenFonts/                         # Lato + Raleway fonts
├── documents/                              # Source materials for /setup
│   ├── README.md                          # Folder layout instructions
│   ├── income/                            # Payslips / proof of income
│   ├── employer/                          # New job contract / offer letter
│   ├── credit/                            # Schufa-Bonitätsauskunft
│   ├── landlord_refs/                     # Previous landlord references
│   └── inquiries/                         # Past flat inquiries (<address-slug>/)
├── flat_scraper/                          # Scraper state (seen listings)
├── flat_search_tracker.csv                # Inquiry tracking spreadsheet
└── SETUP.md                               # Detailed setup guide
```

## How `/apply` works

The `/apply` command runs a **drafter-reviewer workflow** with mandatory PDF compilation:

1. **Parse** the listing (URL or text)
2. **Evaluate fit** against your profile (price, commute to Walldorf, area, size, deal-breakers) and check for scam red flags
3. **Draft** a Selbstauskunft (mostly static, reused across listings) and a tailored Anschreiben in LaTeX
4. **Spawn a reviewer agent** that checks listing-detail claims, scam risk, and generic phrasing
5. **Revise** based on the reviewer's feedback
6. **Compile and inspect** both PDFs: lualatex for the Selbstauskunft, xelatex for the Anschreiben
7. **Present** the final output with a verification checklist — you send it yourself

## Customization

### Which files to edit manually

| File | What to change |
|------|---------------|
| `CLAUDE.md` | Your full renter profile and search criteria |
| `01-renter-profile.md` | Structured identity, household, income, search profile |
| `04-flat-evaluation.md` | Commute tolerance, scoring weights |
| `06-anschreiben-templates.md` | Anschreiben structure/tone |
| `search-criteria.md` | Target areas, budget, portal priority for `/scrape` |

### Updating your search criteria

```
/setup --section search
```

Re-runs the search configuration interview without redoing the full profile.

### Changing the target city/budget/workplace

This fork is configured for Karlsruhe/Heidelberg/Mannheim/Bruchsal, 1.400 € Warmmiete, and a commute to Walldorf. To repoint it elsewhere, edit the "Search Profile" section in `CLAUDE.md` and the location/budget sections in `.claude/skills/flat-scraper/search-criteria.md` and `.claude/skills/flat-application-assistant/04-flat-evaluation.md`.

### LaTeX templates

The Selbstauskunft uses a plain `article`-based template (see `05-selbstauskunft-templates.md`). The Anschreiben uses the same custom `cover.cls` as the original job-search fork, with Lato/Raleway fonts. Replace either with your own templates by updating the corresponding guidance file.

### Adding more portals

`flat-scraper`'s `search-criteria.md` currently prioritizes Kleinanzeigen and WG-Gesucht (weak/moderate anti-bot protection), with Immowelt as secondary and ImmoScout24 best-effort only. If you want to add another portal, add it to the query categories there — but keep using `WebSearch`/`WebFetch` only; do not add scraping logic that tries to bypass a portal's bot protection.

### Starting over

```
/reset profile    # clears renter profile, preserves framework rules
/reset documents  # deletes files from documents/ folder
/reset all        # both
```

`/reset` shows exactly what will be deleted and requires you to type `RESET` to confirm. Nothing is deleted until you do.

## What was removed from the original job-search fork

A few pieces of the original `ai-job-search` framework didn't have a clean rental equivalent and were removed rather than forced into an awkward analogy:

- **Salary benchmarking tool** (`salary_lookup.py`, `tools/`) — no equivalent BYO dataset workflow for rent benchmarking exists yet; use a Mietspiegel lookup ad hoc via WebSearch during evaluation if needed.
- **`/expand` and `/upskill`** — competency-gap analysis and online-presence enrichment don't map onto a renter profile, which is mostly static facts (income, employment, household) rather than an evolving skill set.
- **The four Danish job-portal CLI tools** (`.agents/skills/`) — those were bespoke API-scraping tools for Jobindex/Jobnet/etc. Rather than building equivalent bespoke scrapers for German rental portals (which would mean reverse-engineering APIs behind anti-bot protection), `flat-scraper` uses `WebSearch`/`WebFetch` directly, the same as the original framework's fallback for non-Danish sites.

## Tips for better results

### Speed matters more than for job applications

Job postings stay open for weeks; good, affordable flats in this price range near Heidelberg/Mannheim/Karlsruhe can disappear within hours of being posted. Run `/scrape` often, and don't over-polish an Anschreiben for a fresh, high-fit listing — a fast, correct inquiry beats a slow, perfect one.

### Profile depth still matters, just differently

A job CV benefits from rich narrative detail. A renter profile benefits from **consistency**: the same income figure, employment dates, and household facts must appear identically across every Selbstauskunft and Anschreiben you send. Keep `01-renter-profile.md` as the single source of truth and never let a draft drift from it.

### Recurring searches

Because listings move fast, consider using Claude Code's `/schedule` or `/loop` skills to re-run `/scrape` on a timer (e.g. every 30-60 minutes) rather than only checking manually. This only repeats the same search-and-report behavior on a schedule — it does not add any auto-send capability.

## Acknowledgements

- Forked from [Mads Lorentzen's ai-job-search](https://github.com/MadsLorentzen/ai-job-search)
- Built with [Claude Code](https://claude.com/claude-code) by [Anthropic](https://anthropic.com)

## License

MIT
