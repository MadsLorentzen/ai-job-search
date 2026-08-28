---
desk:
  id: import
  invocation: /import
  title: Import
  description: Ingest hand-found job postings into the scraper inbox.
  arguments:
    - kind: url
      name: url
      required: false
    - kind: multiline
      name: posting
      required: false
---

# /import - Ingest Hand-Found Jobs

Ingests jobs the user found themselves, from `$ARGUMENTS` (pasted text or URLs) or from `job_scraper/inbox.md`, into the same store the scraper uses, so they dedupe against future scrapes and feed straight into `/apply` and `/autofill` without re-fetching.

---

## Step 0: Gather Input

Collect job entries from both sources:

1. **`$ARGUMENTS`**: if the user passed anything (one or more URLs, or pasted posting text), treat it as one or more entries.
2. **`job_scraper/inbox.md`**: Read it. Entries are separated by `---` lines; ignore the instructional header. Each entry may contain a `URL:` line, a `Note:` line, and/or pasted posting text.

If both are empty, say so and remind the user they can paste posting text directly into this command or into `job_scraper/inbox.md`.

Also load state:
- `job_scraper/seen_jobs.json` (create with `{"seen": {}}` if missing)
- `job_search_tracker.csv` if it exists (already-applied companies + roles)

## Step 1: Resolve Each Entry

For each entry:

- **Pasted text present:** use it directly as the posting content. Do NOT fetch the URL too; the pasted text is the source of record.
- **URL only:** use `WebFetch` to retrieve the posting. If the fetch fails (expected for LinkedIn, Indeed, Dice, they block bots), keep the entry but mark it `needs_text` and ask the user to paste the description for that one.
- Extract: **job title**, **company**, **location**, **work arrangement** (remote/hybrid/onsite), **key requirements** (brief), **deadline** (if listed), and any **work-authorization or clearance requirements**.
- Note whether the URL is an employer ATS link (Greenhouse, Lever, Ashby, Workday). If it's an aggregator link, mention that the underlying ATS posting should be found before `/autofill` can drive it, but do not go hunting for it now.

**Dedup check:** skip (and report as already-known) any entry whose URL or company+title already exists in `seen_jobs.json` or `job_search_tracker.csv`. Exception: if the existing entry has no saved posting text and this one has pasted text, save the text and update the entry instead of skipping.

## Step 2: Save Posting Text

For every entry with posting text (pasted or fetched), write it to:

```
job_scraper/postings/<company>_<role-slug>.md
```

Use lowercase, hyphens, no spaces (e.g. `job_scraper/postings/anthropic_ai-engineer.md`). Start the file with a small header:

```markdown
# <Title> - <Company>
- URL: <url or "none">
- Imported: YYYY-MM-DD
- Note: <user note, if any>

---

<full posting text>
```

This file is what `/apply` uses later, so the posting never needs re-fetching or re-pasting.

## Step 3: Quick Fit Assessment

For each new job, do the same rapid fit check the scraper uses (NOT the full `04-job-evaluation.md` framework; that runs during `/apply`):

- **High match**: role directly involves core skills from the candidate profile
- **Medium match**: role is adjacent
- **Low match**: role requires significant skills the profile lacks

Even though the user hand-picked these, still flag **deal-breakers** from `CLAUDE.md` explicitly. The user may have missed them in the posting.

## Step 4: Store & Clean Up

1. Add each processed job to `seen_jobs.json` using the scraper's structure, with two extra fields:

```json
{
  "seen": {
    "<url_or_company_title_key>": {
      "title": "...",
      "company": "...",
      "url": "...",
      "first_seen": "YYYY-MM-DD",
      "deadline": "YYYY-MM-DD" | null,
      "fit": "high/medium/low",
      "status": "new",
      "source": "manual",
      "posting_file": "job_scraper/postings/<company>_<role-slug>.md"
    }
  }
}
```

`status` is `new` - the same value `/scrape` writes - so hand-imported jobs are picked up by `/rank` exactly like scraped ones. (Older versions of this command wrote `"imported"`, which `/rank` treats as `new` for backward compatibility.) `source: "manual"` is what records that the job was hand-imported.

`deadline` is the application deadline extracted in Step 2 (`YYYY-MM-DD`), or `null` when the posting states none - the same base field `/scrape` writes. Persist it here: `/rank`'s urgency and expiry sweep (Step 3, rules 5-6) reason over the stored `deadline`, and an entry with no `deadline` key is left out of the sweep entirely, so a hand-imported job with a real closing date would otherwise never be flagged closing-soon or retired when it lapses. Never guess a deadline the posting does not state.

2. Rewrite `job_scraper/inbox.md` keeping only the instructional header, the trailing `---`, and any `needs_text` entries (annotate those with a `<!-- needs pasted text -->` comment so the user sees why they remain).

## Step 5: Check for Reusable Documents

For each imported job, check whether tailored documents already exist from a prior run:
- `cv/main_<company>_<role>.tex` / `.pdf`
- `cover_letters/cover_<company>_<role>.tex` / `.pdf`

If they exist, say so. `/apply` for a second role at the same company should start from the existing tailored CV, and `/autofill` can attach the PDFs directly.

## Step 6: Present Results

```
## Imported Jobs - YYYY-MM-DD

Imported X jobs (Y high, Z medium, W low match). Skipped N already-known.

| # | Fit | Title | Company | Location | Deal-breakers? | Tailored docs? |
|---|-----|-------|---------|----------|----------------|----------------|
```

For each high-match job, add 2-3 bullets: why it matches, key requirements to verify, any red flags.

Then offer the next step:

> "Want me to run the full evaluation and tailor documents for any of these? Give me the number(s) and I'll run `/apply` using the saved posting text."

When the user picks one, follow the `/apply` workflow (`.claude/commands/apply.md`) passing the saved `job_scraper/postings/` file as the posting source: no re-fetching, no re-pasting.

---

## Important Rules

1. **Pasted text wins over URLs.** Never overwrite user-pasted posting text with a fetched version.
2. **Never fabricate.** If a field (deadline, location) isn't in the posting, record it as unknown. Don't guess.
3. **Respect deduplication** against `seen_jobs.json` AND `job_search_tracker.csv`, same as the scraper.
4. **Deal-breaker flags are informational**, not filters. These are hand-picked jobs, so present them all, but say what you spotted.
