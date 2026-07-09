# AI Job Search — Agent Guide

This is a **fork** of [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search). It is an OpenCode job-application template repo adapted for the Colombian market (with computrabajo-search and elempleo-search portals). The original is a universal fork-and-adapt template — upstream stays market-agnostic and person-agnostic.

## Core Architecture

- **Commands** (`/apply`, `/scrape`, `/setup`, `/rank`, `/interview`, `/outcome`, `/upskill`, `/expand`, `/add-template`, `/add-portal`, `/reset`) are implemented as `.opencode/command/*.md` — loaded by OpenCode.
- **Skills** (`.opencode/skill/`) are the persistent profile + workflow files the commands reference.
- **Portal CLI tools** (`.agents/skills/*/`) are TypeScript/Bun CLI tools for job-board search — each has `search` and `detail` commands with `--format json|table|plain`.
- **LaTeX templates** at `cv/` (moderncv banking, `lualatex`) and `cover_letters/` (custom `cover.cls`, `xelatex`).

## Required LaTeX Compile Commands

- **CV**: `lualatex -interaction=nonstopmode main_<company>.tex` (NOT pdflatex — fails on MiKTeX with fontawesome5)
- **Cover letter**: `xelatex -interaction=nonstopmode cover_<company>_<role>.tex` (cover.cls needs fontspec)
- CV must be **exactly 2 pages**, cover letter **exactly 1 page**. Always compile and visually inspect the PDF; `.tex` appearance is not sufficient.

## Key LaTeX Gotchas

- CV uses `\moderncvstyle{banking}`, `\moderncvcolor{blue}`. Requires three `\renewcommand*` lines for firstname/lastname/section color overrides (see `cv/main_example.tex:16-18`).
- Cover letter `\lettercontent{}` appends `\\` — do NOT wrap `\begin{itemize}...\end{itemize}` inside it (breaks compile). Use the font-wrapped pattern from `06-cover-letter-templates.md:39-50`.
- **Itemize spacing**: Never put `\vspace` between `\item` entries inside itemize — it produces uneven gaps. Only `\vspace` between top-level `\cventry` blocks and after `\section{}`.
- **Page-break fixes**: `\needspace{5\baselineskip}` before a `\cventry` to prevent orphaned titles; `\enlargethispage{2-3\baselineskip}` for near-miss overflow on a trailing section.

## CV Content Rules

- **Relevance-weighted cutting**: Score each line by posting-relevance, uniqueness, and narrative load (does the cover letter depend on it?). Cut lowest score first — regardless of section. Do NOT mechanically cut "oldest section" first.
- **ATS Parseability**: Run `pdftotext -layout main_<company>.pdf` if available. Check for: (1) contact details as literal text (not just icons/hyperlinks), (2) no `(cid:*)` or `�` glyphs, (3) sane reading order, (4) keyword coverage uses posting's exact terms when truthfully applicable. Gaps stay visible — never stuff keywords the profile doesn't support.

## Writing Style (no exceptions)

- **No em-dashes** (`--`). Use commas or restructure.
- **No cliches**: "passionate about", "great fit", "leverage", "hit the ground running", "drive results", "synergies".
- Claims must be **independently verified** via WebFetch/WebSearch (don't trust the reviewer agent at face value).
- **Agentic coding / AI tooling references** must mention **Claude Code** by name.

## CLI Portal Tool Pattern (`.agents/skills/*/`)

- Each lives under `.agents/skills/<name>/cli/`, written in TypeScript, runs with **Bun**.
- Consistent contract: `search` and `detail` subcommands, `--format json|table|plain`, stderr JSON errors with exit 1, backoff on 429/5xx.
- Tests: `bun test --timeout 30000` in `cli/tests/`. Typecheck: `bun run typecheck`.
- `linkedin-search` has **zero runtime dependencies**.
- **CI never makes live portal requests** — portal skills are typechecked, not integration-tested in CI.

## Verification Flow (after any CV/cover letter generation)

1. Compile both PDFs
2. Read and visually inspect the PDF output
3. Check page counts, orphaned entries, font consistency
4. Run ATS text-layer extraction (`pdftotext -layout`) if available
5. Iterate LaTeX fixes until all pass

## Commands Quick Reference

| Command | Source |
|---------|--------|
| `/setup` | `.opencode/command/setup.md` |
| `/scrape` | `.opencode/command/scrape.md` *and* `.opencode/skill/job-scraper/SKILL.md` |
| `/apply <URL-or-text>` | `.opencode/command/apply.md` |
| `/rank` | `.opencode/command/rank.md` |
| `/interview` | `.opencode/command/interview.md` |
| `/outcome` | `.opencode/command/outcome.md` |
| `/upskill` | `.opencode/command/upskill.md` + `.opencode/skill/upskill/SKILL.md` |
| `/expand` | `.opencode/command/expand.md` |
| `/add-template` | `.opencode/command/add-template.md` |
| `/add-portal` | `.opencode/command/add-portal.md` |
| `/reset` | `.opencode/command/reset.md` |

## CI Pipeline (`.github/workflows/ci.yml`)

Order: `lint (skills+commands)` → `latex-smoke` → `cli-typecheck` → `placeholder-integrity` (upstream only)

- **Lint**: `python tools/lint_skills.py` (requires `pip install pyyaml`). Checks SKILL.md YAML frontmatter, command file titles, opencode.json structure.
- **LaTeX smoke**: compiles `cv/main_example.tex` (lualatex) and `cover_letters/cover_example.tex` (xelatex) in `texlive/texlive` container.
- **Placeholder check** (upstream only): verifies `[YOUR_NAME]` and other placeholder tokens remain in tracked files.

## Important Constraints

- **This is a template repo**: Never commit personal data (real names, CVs, cover letters). `[PLACEHOLDER]` tokens must survive in tracked files. Personal output files (`cv/main_*.tex`, `cover_letters/cover_*.tex`, `salary_data.json`, `documents/**`) are gitignored.
- `opencode.json` pre-approves `bun run:*`, `python salary_lookup.py:*`, `pdftotext:*`, `lualatex:*`, `xelatex:*`.
- `salary_lookup.py` is optional — missing `salary_data.json` is normal and the workflow skips salary benchmarking silently.
- `pdftotext` (poppler) is optional — ATS check degrades to visual keyword review if missing.
- Application output files under `documents/applications/<company>_<role>/` use a specific format (`job_posting.md`, `cover_letter.tex`, `cv_draft.tex`, `outcome.md`).
- **Never fabricate skills, experience, or company claims**. Every CV/cover letter claim must trace to the profile and be independently verifiable.

## Verification Checklist

After creating or updating a CV or cover letter, verify ALL of the following before presenting to the user.

### Factual accuracy
- [ ] All claims match actual profile (candidate profile files) — no fabricated skills, experience, or achievements
- [ ] Job titles, dates, company names, and locations are correct
- [ ] Contact details are correct
- [ ] All company-specific claims have been independently verified via WebFetch/WebSearch

### Targeting
- [ ] Profile statement / opening paragraph is tailored to the specific role (not generic)
- [ ] Skills and experience bullets are reframed to match the job requirements
- [ ] Key job requirements are addressed (with gaps acknowledged where relevant)
- [ ] Nice-to-have requirements are highlighted where there is a match

### Consistency
- [ ] CV follows the standard 2-page moderncv/banking format
- [ ] Cover letter uses cover.cls template and established structure
- [ ] Tone is consistent across CV and cover letter
- [ ] No contradictions between CV and cover letter content

### Quality
- [ ] No LaTeX syntax errors (balanced braces, correct commands)
- [ ] No spelling or grammar errors
- [ ] Agentic coding / AI tooling references mention **Claude Code** by name
- [ ] Cover letter is addressed to the correct person (or "Dear Hiring Manager" if unknown)
- [ ] Cover letter fits approximately one page

### Compiled PDF verification (MANDATORY)
- [ ] CV compiled with **lualatex**; cover letter compiled with **xelatex**
- [ ] **CV is exactly 2 pages** — not 1, not 3
- [ ] **No orphaned `\cventry` titles** — use `\needspace{5\baselineskip}` before each `\cventry` and `\enlargethispage{2-3\baselineskip}` for near-miss overflow
- [ ] **Cover letter is exactly 1 page** — signature block must fit
- [ ] **Cover letter bullet font matches body font** — `\lettercontent{}` must not wrap `\begin{itemize}...\end{itemize}`

### ATS & keyword verification (CV)
- [ ] CV text layer extracts cleanly — no `(cid:*)` markers or `�` characters
- [ ] Email and phone appear as literal text in the extraction
- [ ] Reading order matches visual order
- [ ] Posting keywords covered or honestly absent — never stuff unsupported keywords
