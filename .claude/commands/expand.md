# /expand - Competency Expansion from Documents and Online Presence

You are enriching the candidate profile by discovering competencies hidden in documents and public online presence. This command is additive only — it never modifies existing profile content, only extends it.

Follow these steps **exactly in order**. Do not skip steps.

---

## Step 0: Read Existing Profile Files

Read these two files in parallel before doing anything else. You must know what is already there so you do not propose duplicates.

- `.claude/skills/job-application-assistant/01-candidate-profile.md`
- `.claude/skills/job-application-assistant/02-behavioral-profile.md`

Hold this content in context throughout the command. Do not re-read these files later.

---

## Step 1: Discovery — Scan All Sources

**If `$ARGUMENTS` is non-empty, skip this whole step.** The user is naming the experience item directly (`/expand Azure AI Engineer Associate, passed 2026-08`) — take it as prose, claim no date or provider they did not state, and go to Step 2. Ask one question if it is too vague to look up.

Otherwise scan every available source for "experience items" — anything that implies skill, knowledge, or competency. Process sources in this order.

### 1a. documents/cv/
Read all files in `documents/cv/`. Extract:
- Every course or module listed (including university coursework and online courses)
- Every certification mentioned, with issuer and date
- Every job responsibility bullet point (tools, methods, outcomes)
- Every independent project or side project
- Every volunteer or extracurricular role

### 1b. documents/linkedin/
Read all files in `documents/linkedin/`. Extract:
- Courses and certifications in the "Licenses & Certifications" section
- Skills and endorsements list
- Volunteer experiences
- Projects section
- Any platform-specific items not already found in the CV

### 1c. documents/diplomas/
Read all files in `documents/diplomas/`. Extract:
- All course/module names listed on transcripts
- Thesis title and subject area
- Any specialisation or track name

### 1d. documents/references/
Read all files in `documents/references/`. Extract:
- Competency language used by the referee (what skills or qualities they mention)
- Any specific projects, tools, or methods named

### 1e. GitHub Profiles (use the `gh` CLI, not WebFetch)
**WebFetch cannot see private repositories.** Most of a working engineer's recent evidence is private, so a WebFetch-only scan systematically misses the strongest material. Use `gh`.

1. Run `gh auth status` to list available accounts. Note the currently active one — you will restore it after every switch.
2. For **each** account known for this candidate (a personal account and a work account are both normal), run `gh auth switch -u <account>`, then:
   ```bash
   gh api --paginate "user/repos?per_page=100&affiliation=owner&visibility=all" \
     --jq '.[] | "\(.name)\t\(.private)\t\(.language // "-")\t\(.pushed_at[0:7])\t\(.description // "")"'
   ```
   `gh api` does **not** paginate on its own — without `--paginate` everything past the first 100 repos is silently dropped.
3. For each **employer or collaboration org** the candidate belongs to, using an account with access:
   ```bash
   gh api --paginate "orgs/<org>/repos?per_page=100" --jq '.[].name'
   # then per repo (login-regex = the candidate's GitHub login, anchored, e.g. '^octocat'):
   gh api --paginate "repos/<org>/<repo>/contributors?per_page=100" \
     --jq '.[] | select(.login|test("<login-regex>";"i")) | .contributions'
   ```
   `<login-regex>` is a **regex**, not a glob. Anchor it (`^login`) — an unanchored pattern, and especially one carried over from a shell glob (`login*` reads as "zero or more of the last character"), matches unrelated accounts.

   **Do not use `gh search commits`** for this: it caps at 100 results and silently undercounts (it reported 7 commits on a repo that had 76). The contributors API counts the default branch only, so state that limitation in the report rather than presenting counts as complete.

   **Empty output is not evidence of no contribution.** The jq filter prints nothing and exits 0 when the login is absent, when work landed on a non-default branch, or when the account lacks access. List such repos under "Needs manual review" and ask the candidate — do not report them as no involvement.
4. Fetch READMEs only for repos whose description suggests significant new competency signal, and prefer `gh api "repos/<owner>/<repo>/contents/README.md" -H "Accept: application/vnd.github.raw"`.
5. **Restore the originally active account immediately after the last read for each switched account** (`gh auth switch -u <original>`) — not at the end of the command. `gh auth switch` mutates global CLI state on the user's machine, so leaving it switched across the Step 4 confirmation wait breaks `gh` and git credentials in every other terminal. If the command aborts, errors, or the user answers `skip`, restore before exiting.

Private repo contents and employer org work are competency evidence for the local profile, never quotable material for a CV. Record them with that caveat attached.

If no GitHub account is known, skip this source and note it was skipped.

### 1f. Other URLs in Profile
Check `01-candidate-profile.md` for any other URLs (portfolio site, personal website, Kaggle, Google Scholar, ResearchGate, publication links). For each:
- Fetch the page
- Extract any tools, methods, datasets, awards, or skills mentioned

**Google Scholar deserves a dedicated pass** when present: re-read total citations, h-index, i10-index and the full paper list with per-paper citation counts and author position. These numbers change, they are the strongest quantitative credibility signal available, and a stale count on a CV is a missed opportunity rather than an error.

### 1g. Authenticated internal sources
Wikis, ticket systems and document stores behind a login (Confluence, Jira, SharePoint, Google Drive, Notion) often hold the candidate's most substantial recent work: strategy documents they authored, initiatives they own, PoCs they ran.

- **Confluence / Jira:** use the Atlassian MCP tools with the site's `cloudId`. Search the space for pages the candidate authored; a page ID the candidate supplies can be fetched directly.
- **SharePoint / OneDrive / Office documents:** require an authenticated Microsoft 365 connector. If it is not connected, say so plainly and ask the candidate either to authenticate it or to export the file locally and give you the path. **Never** reconstruct the contents of a document you could not read, and never present hand-supplied summaries as if the source had been verified.
- Everything from these sources is employer-confidential by default. Record it with an `[internal]` marker and flag it as needing a clearance check before it appears on a CV or in a cover letter.

---

## Step 2: Web Enrichment

For each experience item discovered in Step 1, search the web to extract the competencies it implies. Apply both approaches below — do not choose one over the other.

### Approach A: Direct lookup (explicit tools and frameworks)
If the item names a specific tool, framework, library, method, or platform, search for it directly:
- `"[Course name] [Provider] syllabus learning outcomes"`
- `"[Certification name] skills covered exam guide"`
- `"[Tool/framework name] skills what you learn"`

Fetch the most relevant page and extract the competency list.

### Approach B: Inferred competencies (from description and context)
For each item, regardless of whether Approach A found anything, also reason from the description:
- What problem domain does this item address?
- What methods, skills, or knowledge does someone need to do this work?
- What is the standard toolchain for this kind of work?

Combine both approaches into a single competency list for each item.

### Prioritise web lookup for:
- Named online courses (Coursera, edX, Udemy, LinkedIn Learning, DataCamp, fast.ai, etc.)
- Named certifications (AWS, GCP, Azure, Databricks, Tableau, etc.)
- University courses with a standard syllabus
- GitHub repositories with a README that names specific technologies

### Infer (without web lookup) for:
- Generic job responsibility bullets with no named tool
- Vague project descriptions
- Reference letter language (already phrased as competency — just record it)

---

## Step 3: Build Competency Map

After enriching all items, build a deduplicated competency map. Group findings into these categories:

**Technical Skills — Primary** (core languages, frameworks, methods you use regularly)  
**Technical Skills — Secondary** (tools you have used but are not primary)  
**Domain Knowledge** (subject matter expertise: geophysics, ML, NLP, etc.)  
**Methods and Practices** (agile, version control, reproducibility, testing, etc.)  
**Soft / Behavioral** (leadership, communication, collaboration signals from references and project descriptions)  

For each competency, record:
- The competency name
- The source item it came from (e.g. "Coursera — Deep Learning Specialisation", "GitHub — repo-name", "Reference letter — Jens Jensen")
- Whether it came from direct lookup (A), inference (B), or both

Remove anything already present in `01-candidate-profile.md` or `02-behavioral-profile.md`.

---

## Step 4: Present Grouped Summary

Present all new competencies for the user's review before writing anything. Format:

```
## /expand found [N] new competency signals across [M] sources

**COURSES & CERTIFICATIONS**
Source: [Course/cert name — Provider]
  + [Competency 1]
  + [Competency 2]
  ...

**GITHUB — [repo-name]**
Source: README + inferred from tech stack
  + [Competency 1]
  + [Competency 2]
  ...

**JOB RESPONSIBILITIES — [Company, Role]**
Source: CV bullets + direct tool lookup
  + [Competency 1]
  ...

**BEHAVIORAL SIGNALS**
Source: [Reference letter — Name / LinkedIn About / Project leadership]
  + [Signal 1]
  ...

[more sections as needed]
```

Then ask:

> **How would you like to proceed?**
>
> - **`all`** — Add everything above to your profile
> - **`review`** — I'll walk you through each source group one at a time
> - **`skip`** — Cancel without writing anything
>
> Or list specific groups to skip (e.g. "skip GitHub, add everything else").

Wait for the user's response before writing anything.

---

## Step 5: Write Confirmed Additions

Apply only the confirmed items. Use the Edit tool to add to the relevant sections of each file — do not rewrite entire files.

### Additions to `01-candidate-profile.md`
- Technical skills (primary and secondary) → append to the Technical Skills section
- Domain knowledge → append to the Domain Knowledge or Technical Skills section (match the existing structure)
- Methods and practices → append appropriately
- Certifications (name, issuer, date) → append to the `## Certifications` section; if the file has none, create it directly after `## Education`. Record the certification as its own fact, not only the competencies it implies — a certification dropped in favour of its implied skills never reaches the CV
- Awards, courses and volunteering → the matching existing section (`## Awards`, `## Volunteering & Extracurricular`)

For each addition, add a brief source annotation in a comment or parenthetical: *(Coursera — Deep Learning Specialisation)*, *(GitHub — project-name)*, etc. This makes future `/expand` runs idempotent.

### Additions to `02-behavioral-profile.md`
- Soft/behavioral signals → append to the "Strongest Behavioral Traits" or "How I Work Best" section (match existing structure)
- Always label inferred behavioral additions: *[Inferred from reference letter — Name / review before relying on this]*

---

## Step 6: Summary Report

After writing, present:

```
## /expand Complete

### Added to 01-candidate-profile.md
[List each competency added, with source]

### Added to 02-behavioral-profile.md
[List each behavioral signal added, with source]

### Sources processed
[List each source scanned and how many competencies it yielded]

### Sources skipped
[List any sources that were missing, empty, or yielded nothing new — with brief reason]

### Needs manual review
[Any items that were ambiguous, partially readable, or where web lookup returned no clear syllabus]
```

---

## Design Principles

- **Additive only.** This command never modifies existing profile content. It only appends.
- **Source-traceable.** Every addition records where it came from, so future runs are idempotent and the user can verify or remove individual items later.
- **Both approaches, always.** Web lookup and inference are applied together — not as alternatives. A named course gets its official syllabus AND a reasoned competency list.
- **User confirms before writing.** The full competency map is shown and confirmed before a single file is touched.
- **Behavioral signals are labeled.** Anything inferred from tone, language, or indirect signals is marked as inferred so it is reviewed critically.
- **GitHub is fully scanned.** Every known account and org is scanned via the `gh` CLI — private and org repositories included, not just public or pinned ones, and paginated so nothing past the first 100 is dropped. Private and employer material is local competency evidence only, never quotable on a CV.
