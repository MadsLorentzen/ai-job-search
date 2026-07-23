<p align="center">
  <img src="claude_animation.gif" alt="AI Job Search Assistant" width="200">
</p>

# AI Job Search — OpenCode Edition

> **Fork of** [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search) — migrated from Claude Code to OpenCode, with Colombian job portals added.

[![CI](https://github.com/[YOUR_GITHUB_USERNAME]/ai-job-search-opencode/actions/workflows/ci.yml/badge.svg)](https://github.com/[YOUR_GITHUB_USERNAME]/ai-job-search-opencode/actions/workflows/ci.yml)

## What's different in this fork

This fork adapts the original AI-powered job application framework for the **Colombian market** and the **OpenCode** ecosystem:

- **Migrated from `.claude/` to `.opencode/`**: the entire command, agent, and skill structure now uses OpenCode's native layout
- **Colombian job portals**: added CLI tools for [Computrabajo Colombia](https://www.computrabajo.com.co) and [Elempleo](https://www.elempleo.com/co) — search and detail commands with the same `json|table|plain` contract as the original Danish portals
- **Colombian Spanish skill metadata**: both portal skills have Spanish-language SKILL.md files with market-appropriate trigger phrases
- **Updated `search-queries.md`**: includes Colombia-specific job queries

All original framework features (CV/cover letter drafting, fit evaluation, interview prep, salary benchmarking) remain intact and functional.

## Original description

An AI-powered job application framework built on [OpenCode](https://opencode.ai). Fork it, fill in your profile, and let the AI evaluate job postings, tailor your CV, write cover letters, and prepare you for interviews.

> Note: This is an independent open-source project. It uses Claude Code as the AI assistant for CV/cover letter writing and is not affiliated with Anthropic.

## What this is

A structured workflow that turns an AI coding assistant into a full-stack job application assistant. The core workflow (self-profiling, fit evaluation, and the drafter-reviewer application pipeline) is **language- and country-agnostic**. The job portal search skills are built for the Danish market (Jobindex, Jobnet, Akademikernes Jobbank, etc.) plus two Colombian portals (Computrabajo, Elempleo), but the pattern is designed to be swapped for your local job boards.

```
/setup          /scrape              /apply <url>
  |                |                     |
  v                v                     v
Fill in        Search job           Evaluate fit
your profile   portals              Score & recommend
  |                |                     |
  v                v                     v
Profile        Present matches      Draft CV + Cover Letter
files ready    with fit ratings     (LaTeX, tailored)
                   |                     |
                   v                     v
               Pick a match         Reviewer agent critiques
               -> /apply            -> Revise -> Final output
```

The framework encodes career guidance best practices, including structured evaluation criteria, forward-looking cover letter framing, and optional salary benchmarking.

## Prerequisites

- [OpenCode](https://opencode.ai) (CLI)
- Python 3.10+
- [Bun](https://bun.sh) (for job search CLI tools)
- LaTeX distribution with `lualatex` and `xelatex`: [TeX Live](https://tug.org/texlive/), [MacTeX](https://tug.org/mactex/), [TinyTeX](https://yihui.org/tinytex/), or [MiKTeX](https://miktex.org/). The CV compiles with `lualatex` (pdflatex often fails on modern MiKTeX installs with `fontawesome5` font-expansion errors); the cover letter compiles with `xelatex` because `cover.cls` requires `fontspec`.
- Optional: `pdftotext` from [poppler](https://poppler.freedesktop.org/) — used by `/apply`'s ATS parseability check on the compiled CV. If missing, the check degrades gracefully to a visual keyword review.

## Quick start

### 1. Clone

```bash
git clone https://github.com/[YOUR_GITHUB_USERNAME]/ai-job-search-opencode.git
cd ai-job-search-opencode
```

### 2. Install job search tools

PowerShell:

```powershell
$tools = @("jobbank-search", "jobdanmark-search", "jobindex-search", "jobnet-search", "linkedin-search", "computrabajo-search", "elempleo-search")
foreach ($tool in $tools) {
  Set-Location ".agents/skills/$tool/cli"
  bun install
  Set-Location ..\..\..\..
}
```

Bash / zsh / Git Bash:

```bash
for tool in jobbank-search jobdanmark-search jobindex-search jobnet-search linkedin-search computrabajo-search elempleo-search; do
  cd ".agents/skills/$tool/cli" && bun install && cd ../../../..
done
```

For `linkedin-search` and the Colombian portals the install is optional: they have zero runtime dependencies and run with plain `bun`; `bun install` only pulls TypeScript dev types.

### 3. Set up your profile

```bash
opencode
# Then inside the session:
/setup
```

`/setup` offers three paths: read your `documents/` folder if you have one populated (CV PDF, LinkedIn export, diplomas, reference letters, past applications), import a single CV pasted in chat, or walk through an interview. It auto-detects what you have and asks.

### 4. Search for jobs

```bash
/scrape
```

This searches multiple job portals for positions matching your profile, deduplicates results, and presents them sorted by fit. Pick a match to run `/apply` on it directly — or, when a scrape returns more jobs than you want to eyeball, run `/rank` to batch-score them all against the fit framework and get a ranked shortlist first.

### 5. Apply to a job

```bash
/apply https://computrabajo.com.co/ofertas-de-trabajo/oferta-de-trabajo-de-...
```

If the URL can't be fetched (some job portals block automated access), you can paste the job description directly instead:

```bash
/apply <paste the full job description here>
```

This runs the full workflow: evaluate fit, draft CV + cover letter, review with a second agent, revise, and present the final output.

## Other commands

`/setup`, `/scrape`, and `/apply` form the core workflow. Seven more commands extend it once your profile is in place:

- **`/interview`** preps you for a scheduled interview on a tracked application.
- **`/outcome`** records what happened to an application — interview stages, offers, rejections, silence.
- **`/rank`** bridges `/scrape` and `/apply`: it batch-scores all newly scraped postings against the fit framework.
- **`/expand`** enriches your profile by scanning public sources you've already linked.
- **`/upskill`** analyzes the gap between your profile and your tracked job postings.
- **`/add-template`** registers your own LaTeX CV or cover letter template.
- **`/add-portal`** generates a job-portal search skill for a job board in your market.

`/reset` is also available.

## File structure

```
ai-job-search-opencode/
├── AGENTS.md                          # Main agent guide + workflow rules
├── opencode.json                      # OpenCode config (permissions, commands, agents)
├── .opencode/
│   ├── command/                       # Command files for /apply, /setup, etc.
│   ├── agent/                         # Subagent definitions (reviewer, job-scorer)
│   └── skill/                         # Profile + workflow files
│       ├── job-application-assistant/  # Core application skill
│       │   ├── SKILL.md               # Skill definition
│       │   ├── 01-candidate-profile.md # Your education, experience, skills
│       │   ├── 02-behavioral-profile.md# PI/DISC/personality assessment
│       │   ├── 03-writing-style.md    # Tone, structure, do's and don'ts
│       │   ├── 04-job-evaluation.md   # Scoring framework for job fit
│       │   ├── 05-cv-templates.md     # LaTeX CV structure + tailoring rules
│       │   ├── 06-cover-letter-templates.md # LaTeX cover letter templates
│       │   └── 07-interview-prep.md   # STAR examples + interview framework
│       ├── scrape/                    # Job search orchestration
│       └── upskill/                   # /upskill skill gap analysis and learning plan
├── .agents/skills/                    # Job portal CLI tools
│   ├── jobbank-search/                # Akademikernes Jobbank (Denmark)
│   ├── jobdanmark-search/             # Jobdanmark.dk (Denmark)
│   ├── jobindex-search/               # Jobindex.dk (Denmark)
│   ├── jobnet-search/                 # Jobnet.dk (Denmark, government portal)
│   ├── linkedin-search/               # LinkedIn public job listings (country-agnostic)
│   ├── computrabajo-search/           # Computrabajo Colombia (added in this fork)
│   └── elempleo-search/               # Elempleo Colombia (added in this fork)
├── cv/
│   └── main_example.tex               # moderncv LaTeX template
├── cover_letters/
│   ├── cover.cls                      # Custom cover letter LaTeX class
│   ├── cover_example.tex              # Example cover letter
│   └── OpenFonts/                     # Lato + Raleway fonts
├── templates/                         # Custom templates registered via /add-template
├── documents/                         # Career source materials for /setup
├── .github/workflows/ci.yml           # CI: LaTeX smoke compiles, skill lint, CLI typechecks
├── salary_lookup.py                   # Salary benchmarking tool (BYO data)
├── tools/
│   ├── convert_salary_excel.py        # Convert salary Excel to JSON
│   ├── lint_skills.py                 # CI lint for skills, commands, settings.json
│   └── README_SALARY_TOOL.md          # Salary tool setup instructions
├── job_scraper/                       # Scraper state (seen jobs, results)
├── upskill/                           # /upskill report output
├── job_search_tracker.csv             # Application tracking spreadsheet
└── SETUP.md                           # Detailed setup guide
```

## How `/apply` works

The `/apply` command runs a **drafter-reviewer workflow** with mandatory PDF compilation:

1. **Parse** the job posting (URL or text)
2. **Evaluate fit** against your profile
3. **Draft** a tailored CV and cover letter in LaTeX
4. **Spawn a reviewer agent** that researches the company and critiques the drafts
5. **Revise** based on the reviewer's feedback
6. **Compile and inspect** both PDFs: lualatex for the CV, xelatex for the cover letter
7. **ATS-check the CV**: extract the PDF's text layer and verify it the way an ATS parser sees it
8. **Present** the final output with a verification checklist

All claims in the CV and cover letter are verified against your actual profile. The system never fabricates skills or experience.

## Launching portal CLIs directly

The portal tools can be used standalone outside of OpenCode:

```bash
# Computrabajo Colombia
cd .agents/skills/computrabajo-search/cli
bun run src/cli.ts search -q "ingeniero software" --location "Bogotá" --format table
bun run src/cli.ts detail "https://co.computrabajo.com/ofertas-de-trabajo/..." --format plain

# Elempleo Colombia
cd .agents/skills/elempleo-search/cli
bun run src/cli.ts search -q "analista datos" --location "Medellín" --format table
bun run src/cli.ts detail "https://www.elempleo.com/co/ofertas-trabajo/..." --format plain
```

## Acknowledgements

- [Mads Lorentzen](https://github.com/MadsLorentzen) for the original [ai-job-search](https://github.com/MadsLorentzen/ai-job-search) framework
- [Mikkel Krogholm](https://github.com/mikkelkrogsholm) for the original job search CLI skills pattern
- Built with [Claude Code](https://claude.com/claude-code) by [Anthropic](https://anthropic.com)
- [OpenCode](https://opencode.ai) for the CLI platform

## License

MIT — see [LICENSE](LICENSE). Original work copyright (c) 2026 Mads Lorentzen. Modifications copyright (c) 2026 [YOUR_NAME].
