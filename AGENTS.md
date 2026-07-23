# AI Job Search — Agent Guide

Owner: [YOUR_NAME]

Fork of [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search). OpenCode job-application template adapted for the Colombian market (computrabajo-search, elempleo-search portals). Upstream stays market-agnostic and person-agnostic.

## Architecture

- **Commands** (`.opencode/command/*.md`): `/apply`, `/scrape`, `/setup`, `/rank`, `/interview`, `/outcome`, `/upskill`, `/expand`, `/add-template`, `/add-portal`, `/reset` — loaded by OpenCode.
- **Skills** (`.opencode/skill/`): persistent profile + workflow files the commands reference. Core skill: `job-application-assistant/` with 7 numbered reference files (01-07).
- **Portal CLI tools** (`.agents/skills/*/cli/`): TypeScript/Bun CLIs for job-board search. Each has `search` and `detail` subcommands with `--format json|table|plain`. Seven portals: four Danish (jobbank, jobdanmark, jobindex, jobnet), LinkedIn, and two Colombian (computrabajo, elempleo).
- **LaTeX templates**: CV at `cv/` (moderncv banking, `lualatex`), cover letters at `cover_letters/` (custom `cover.cls`, `xelatex`). Only `main_example.tex` and `cover_example.tex` are tracked; personal variants are gitignored.
- **Agent subagents** (`.opencode/agent/`): `reviewer` (critiques drafts, returns structured feedback) and `job-scorer` (scores postings against profile).

## LaTeX Compile Commands

- **CV**: `lualatex -interaction=nonstopmode main_<company>.tex` (NOT pdflatex — fails on MiKTeX with fontawesome5)
- **Cover letter**: `xelatex -interaction=nonstopmode cover_<company>_<role>.tex` (cover.cls needs fontspec)
- CV must be **exactly 2 pages**, cover letter **exactly 1 page**. Always compile and visually inspect the PDF; `.tex` appearance is not sufficient.

### Key LaTeX Gotchas

- CV uses `\moderncvstyle{banking}`, `\moderncvcolor{blue}`. Requires three `\renewcommand*` lines for firstname/lastname/section color overrides (see `cv/main_example.tex:16-18`).
- Cover letter `\lettercontent{}` appends `\\` — do NOT wrap `\begin{itemize}...\end{itemize}` inside it (breaks compile). Use the font-wrapped pattern from `06-cover-letter-templates.md:39-50`.
- **Itemize spacing**: Never put `\vspace` between `\item` entries inside itemize — it produces uneven gaps. Only `\vspace` between top-level `\cventry` blocks and after `\section{}`.
- **Page-break fixes**: `\needspace{5\baselineskip}` before a `\cventry` to prevent orphaned titles; `\enlargethispage{2-3\baselineskip}` for near-miss overflow on a trailing section.

## CV Content Rules

- **Relevance-weighted cutting**: Score each line by posting-relevance, uniqueness, and narrative load (does the cover letter depend on it?). Cut lowest score first — regardless of section. Do NOT mechanically cut "oldest section" first.
- **ATS Parseability**: Run `pdftotext -layout main_<company>.pdf` if available. Check for: (1) contact details as literal text (not just icons/hyperlinks), (2) no `(cid:*)` or replacement-glyph characters, (3) sane reading order, (4) keyword coverage uses posting's exact terms when truthfully applicable. Gaps stay visible — never stuff keywords the profile doesn't support.

## Writing Style (no exceptions)

- **No em-dashes** (`--`). Use commas or restructure.
- **No cliches**: "passionate about", "great fit", "leverage", "hit the ground running", "drive results", "synergies".
- Claims must be **independently verified** via WebFetch/WebSearch (don't trust the reviewer agent at face value).
- **Agentic coding / AI tooling references** must mention **Claude Code** by name.

## CLI Portal Tool Pattern (`.agents/skills/*/cli/`)

- TypeScript, runs with **Bun**. Consistent contract: `search`/`detail` subcommands, `--format json|table|plain`, stderr JSON errors with exit 1, backoff on 429/5xx.
- Each has `package.json` with `"test": "bun test --timeout 30000"` and `"typecheck": "tsc --noEmit"`.
- `linkedin-search` has **zero runtime dependencies**.
- **CI never makes live portal requests** — portal skills are typechecked, not integration-tested in CI.

## Branch Convention

Default branch is **`master`** (not `main`).

## Verification Flow (after any CV/cover letter generation)

1. Compile both PDFs (lualatex for CV, xelatex for cover letter)
2. Read and visually inspect the PDF output
3. Check page counts, orphaned entries, font consistency
4. Run ATS text-layer extraction (`pdftotext -layout`) if available
5. Iterate LaTeX fixes until all pass

### Mandatory checklist before presenting output

- [ ] CV is exactly 2 pages; cover letter is exactly 1 page
- [ ] No orphaned `\cventry` titles (use `\needspace` + `\enlargethispage`)
- [ ] Cover letter bullet font matches body font — `\lettercontent{}` must not wrap `\begin{itemize}...\end{itemize}`
- [ ] All claims match actual profile — no fabricated skills, experience, or achievements
- [ ] Company-specific claims independently verified via WebFetch/WebSearch
- [ ] Cover letter addressed to correct person (or "Dear Hiring Manager" if unknown)
- [ ] No em-dashes, no cliches
- [ ] Agentic/AI references mention Claude Code by name
- [ ] ATS text extraction clean — no `(cid:*)` markers, email/phone as literal text

## Commands Quick Reference

| Command | Source |
|---------|--------|
| `/setup` | `.opencode/command/setup.md` |
| `/scrape` | `.opencode/command/scrape.md` + `.opencode/skill/job-scraper/SKILL.md` |
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

Order: `lint` → `latex-smoke` → `cli-typecheck` → `placeholder-integrity`

- **Lint**: `python tools/lint_skills.py` (requires `pip install pyyaml`). Checks SKILL.md YAML frontmatter, command file titles, opencode.json structure.
- **LaTeX smoke**: compiles `cv/main_example.tex` (lualatex) and `cover_letters/cover_example.tex` (xelatex) in `texlive/texlive` container. Asserts exact page counts (2 for CV, 1 for cover letter).
- **CLI typecheck**: matrix of all 7 portal CLIs, each runs `bun install` then `bun run typecheck` in `.agents/skills/<tool>/cli/`.
- **Placeholder integrity**: verifies `[YOUR_NAME]` and other placeholder tokens survive in tracked template files (AGENTS.md, cv/main_example.tex, cover_letters/cover_example.tex, skill files).

### Running CI-equivalent checks locally

```bash
python tools/lint_skills.py                          # skill/command lint
cd .agents/skills/computrabajo-search/cli && bun run typecheck  # per-CLI typecheck
python -m unittest discover tests                    # Python tool tests
```

## Important Constraints

- **This is a template repo**: Never commit personal data. `[PLACEHOLDER]` and `[YOUR_NAME]` tokens must survive in tracked files. Personal output files (`cv/main_*.tex`, `cover_letters/cover_*.tex`, `salary_data.json`, `documents/**`) are gitignored.
- `opencode.json` pre-approves: `bun run:*`, `python salary_lookup.py:*`, `pdftotext:*`, `lualatex:*`, `xelatex:*`. All other bash commands require user approval.
- `salary_lookup.py` is optional — missing `salary_data.json` is normal; salary benchmarking is skipped silently.
- `pdftotext` (poppler) is optional — ATS check degrades to visual keyword review if missing.
- Application output goes under `documents/applications/<company>_<role>/` with format: `job_posting.md`, `cover_letter.tex`, `cv_draft.tex`, `outcome.md`.
- **Never fabricate skills, experience, or company claims**. Every CV/cover letter claim must trace to the profile and be independently verifiable.
- `CONTRIBUTING.md` defines the contribution policy — new portal skills for specific markets are declined; the pattern is designed to be forked.
