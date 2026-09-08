<p align="center">
  <img src="assets/mascot/pip_flight_loop.gif" alt="Pip, the courier bird" height="140">
  &nbsp;&nbsp;
  <img src="gui/build/icon.png" alt="Job Search Desk" height="140">
</p>

# Job Search Desk

*A US job search that runs on your machine. Install the Desk, or clone the repo and talk to Claude Code.*

<p align="center">
  <a href="https://github.com/iLevyTate/ai-job-search/actions/workflows/ci.yml"><img src="https://github.com/iLevyTate/ai-job-search/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/iLevyTate/ai-job-search/actions/workflows/desk-release.yml"><img src="https://github.com/iLevyTate/ai-job-search/actions/workflows/desk-release.yml/badge.svg" alt="Desk release"></a>
  <a href="https://github.com/iLevyTate/ai-job-search/releases/latest"><img src="https://img.shields.io/github/v/release/iLevyTate/ai-job-search?label=Job%20Search%20Desk" alt="Latest Job Search Desk release"></a>
</p>

This repository is the public **US** product: English defaults, US job boards, and an installable **[Job Search Desk](https://github.com/iLevyTate/ai-job-search/releases/latest)** for Windows, macOS Apple Silicon, and Linux. Open the app or clone the repo, run `/setup` once, then scrape, rank, tailor a CV and cover letter, and prep interviews. Claude Code is the runtime. Your profile and applications stay in a folder on your computer.

It is not the original Danish-market template. Methodology started there; this repo is a separate build with its own Desk app, release train, and North American defaults.

> Independent open-source project. Not affiliated with, endorsed by, or maintained by Anthropic. Claude Code is the toolchain this workflow uses.
>
> No cryptocurrency, token, or paid sponsorship program. Anything claiming otherwise is a scam.

## Install Job Search Desk

Download the latest installer from **[Releases](https://github.com/iLevyTate/ai-job-search/releases/latest)**.

| OS | Installer |
| --- | --- |
| Windows | `JobSearchDesk-*-win-x64.exe` (NSIS: replace or keep the old app) or the portable `.exe` |
| macOS Apple Silicon | `JobSearchDesk-*-mac-arm64.dmg` |
| Linux | `JobSearchDesk-*-linux-x64.AppImage` |

Release CI does **not** build Intel Mac. Apple Silicon only on macOS.

1. Run the installer. Windows adds Start Menu and Desktop shortcuts and launches the app. If Windows SmartScreen says it protected your PC, click **More info**, then **Run anyway**. That warning is a missing signature, not a virus scan. macOS: open the `.dmg` and drag the app to Applications. Linux: mark the AppImage executable and run it.
2. Open an existing job-search folder, or create a new copy of this public repo (Git is optional).
3. The desk starts Claude Code when it opens. If Claude Code is missing, it runs Anthropic's installer. If you are signed out, it opens the same **claude.ai** login you use in Chrome.
4. After you are signed in, run **Setup** once so the folder has your profile.

A second click of the shortcut focuses the window that is already running. It does not start a second desk.

macOS Gatekeeper: the release is unsigned. In Finder, right-click the app, then **Open**.

The app does not replace `/setup`. Autofill never clicks Submit.

From a clone, the same desk starts with:

```bash
node gui/server.mjs
```

Terminal instead of the page:

```bash
node gui/server.mjs --cli
```

See [gui/README.md](gui/README.md).

## What you get

```
/setup          /scrape              /apply <url>          /autofill <url>
  |                |                     |                       |
  v                v                     v                       v
Fill in        Search US            Evaluate fit           Prefill the
your profile   boards + ATS         Score & recommend      employer's form
  |                |                     |                       |
  v                v                     v                       v
Profile        Present matches      Draft CV + Cover Letter  Screenshot +
files ready    with fit ratings     (LaTeX, tailored)        field report
                   |                     |                       |
                   v                     v                       v
               Pick a match         Reviewer agent critiques  YOU review
               -> /apply            -> Revise -> Final output  and submit
```

**`/autofill` never clicks Submit.** It fills the form, attaches your tailored documents, screenshots the result, and hands the browser to you. Automated submission on LinkedIn, Indeed, and Dice violates their Terms of Service.

Discovery defaults to LinkedIn, Indeed, Dice, Built In, Wellfound, ClearanceJobs, USAJobs, freehire.me, and employer ATS boards on Greenhouse, Lever, Ashby, and Workday. Danish portal CLIs still ship, disabled, so methodology updates do not flip the default search path.

## Prerequisites

- [Claude Code](https://claude.com/claude-code) (the Desk installer can install it). Other agent CLIs can use the portal skills in [AGENTS.md](AGENTS.md).
- Python 3.10+
- [Bun](https://bun.sh) (job search and autofill CLIs)
- Chromium via Playwright (for `/autofill`; installed below)
- LaTeX with `lualatex` and `xelatex`: [TeX Live](https://tug.org/texlive/), [MacTeX](https://tug.org/mactex/), [TinyTeX](https://yihui.org/tinytex/), or [MiKTeX](https://miktex.org/). CV compiles with `lualatex`; cover letter compiles with `xelatex` (`cover.cls` needs `fontspec`). Minimal TeX installs need the extra packages in [SETUP.md](SETUP.md#minimal-tex-install-tinytexbasictex).
- Optional: `pypdf` (`pip install pypdf`) and/or `pdftotext` from [poppler](https://poppler.freedesktop.org/). `/apply` uses `python tools/verify_pdf.py` for the ATS parseability check.

## Start from a clone

```bash
gh repo clone iLevyTate/ai-job-search
cd ai-job-search
```

> [!IMPORTANT]
> **A GitHub fork of a public repo is always public.** `/setup` writes personal data (name, contact details, employment history, salary expectations) into **tracked** files. For your own job search, create a **private** repository and add this repo as `upstream`. The two-minute recipe is in [SETUP.md section 8](SETUP.md#8-pulling-upstream-updates-into-your-fork). Fork only when you intend to contribute.

### Install job search tools

PowerShell:

```powershell
$tools = @("linkedin-search", "freehire-search", "ats-autofill")
foreach ($tool in $tools) {
  Push-Location ".agents/skills/$tool/cli"
  bun install
  Pop-Location
}
Push-Location ".agents/skills/ats-autofill/cli"
bunx playwright install chromium
Pop-Location
```

Bash / zsh / Git Bash:

```bash
for tool in linkedin-search freehire-search ats-autofill; do
  (cd .agents/skills/$tool/cli && bun install)
done
(cd .agents/skills/ats-autofill/cli && bunx playwright install chromium)
```

`linkedin-search` and `freehire-search` have zero runtime dependencies. `ats-autofill` needs Playwright Chromium.

### Set up your profile

```bash
claude
# Then inside Claude Code, or from the Desk:
/setup
```

`/setup` can read a populated `documents/` folder, import a CV pasted in chat, or walk through an interview.

### Search, then apply

```bash
/scrape
/apply https://job-boards.greenhouse.io/acme/jobs/1234567
```

If the URL cannot be fetched (Indeed, Dice, and LinkedIn block automated access), paste the posting:

```bash
/apply <paste the full job description here>
```

Postings are untrusted input. Details in [SECURITY.md](SECURITY.md).

## Other commands

- **`/interview`** builds a stage-specific prep pack from the application's archive and offers a mock interview.
- **`/outcome`** records what happened, archives the materials you submitted, and can draft a follow-up (never sends).
- **`/notion-sync`** publishes a one-way, read-only pipeline view into Notion. Repo files stay the system of record.
- **`/gmail-sync`** reads Gmail for status signals and proposes tracker updates for you to approve.
- **`/rank`** batch-scores scraped postings and returns a shortlist.
- **`/import`** ingests postings you found yourself into the scraper's store, so they dedupe against future scrapes and feed `/apply` and `/autofill` directly.
- **`/expand`** enriches your profile from public sources you already linked.
- **`/upskill`** maps skill gaps against tracked and ranked postings and drafts a learning plan.
- **`/html-report`** writes a self-contained offline dashboard from `job_search_tracker.csv`.
- **`/add-template`** registers your own CV or cover letter toolchain.
- **`/add-portal`** scaffolds a search skill for another job board.
- **`/reset`** wipes profile data after you type `RESET`. See [Starting over](#starting-over).

## File structure

```
ai-job-search/
├── CLAUDE.md                          # Candidate profile + workflow rules
├── .claude/commands/                  # /apply, /scrape, /setup, ...
├── .claude/skills/                    # Application, scraper, and upskill skills
├── .agents/skills/                    # Portal CLIs (US enabled; Danish disabled)
├── application_profile.example.json   # Autofill profile template
├── cv/                                # Stock ATS resume template
├── cover_letters/                     # cover.cls + fonts
├── templates/                         # Custom templates from /add-template
├── documents/                         # Source materials for /setup
├── .github/workflows/desk-release.yml # Desk installers on desk-v* tags
├── gui/                               # Job Search Desk (Electron + localhost)
├── tools/                             # Lint, PDF verify, upstream preview
├── job_scraper/                       # Scraper state
├── job_search_tracker.csv             # Application tracker
└── SETUP.md                           # Detailed setup guide
```

## How `/apply` works

1. **Parse** the posting (URL or text)
2. **Evaluate fit** against your profile
3. **Draft** a tailored CV and cover letter in LaTeX
4. **Spawn a reviewer agent** that researches the company and critiques the drafts
5. **Revise** from that critique
6. **Compile and inspect** both PDFs (`lualatex` for the CV, `xelatex` for the cover letter) until the CV is 2 pages and the cover letter is 1 page
7. **ATS-check the CV** with `python tools/verify_pdf.py`: contact details as literal text, sane reading order, honest keyword coverage
8. **Present** the final output with a verification checklist

Claims are checked against your profile. The workflow does not invent skills or jobs.

What that is for: LaTeX that "looks fine in the `.tex`" still orphans job titles, spills a cover letter onto page 2, or embeds a text layer an ATS cannot read. `/apply` compiles, reads the pages, and extracts the text layer before you send anything.

## Customization

| File | What to change |
|------|----------------|
| `CLAUDE.md` | Full profile |
| `01-candidate-profile.md` | Structured CV data |
| `02-behavioral-profile.md` | Behavioral assessment |
| `04-job-evaluation.md` | Skill areas, goals, filters |
| `05-cv-templates.md` | Profile-statement templates |
| `07-interview-prep.md` | STAR examples from real work |
| `search-queries.md` | Search queries for your skills and location |

Reconfigure search without a full reset:

```
/setup --section search
```

Register your own CV or cover letter toolchain with `/add-template`. Add another US board with `/add-portal`. Enabled by default here:

- **`linkedin-search`**: LinkedIn public `jobs-guest` listings. Personal use only; keep volume low.
- **`freehire-search`**: [freehire.me](https://freehire.me) public API. Self-hostable via [strelov1/freehire](https://github.com/strelov1/freehire).

Portal skills you copy from elsewhere should be read in full before you run them. They execute on your machine against your career data.

### Salary benchmarking

Optional. Provide your own data. See `tools/README_SALARY_TOOL.md`. If the file is missing, `/apply` skips the step.

### Starting over

```
/reset profile    # clears skill files, keeps framework rules
/reset documents  # deletes files from documents/
/reset all        # both
```

`/reset` lists what it will delete and waits for you to type `RESET`.

### Staying up to date

Prefer tagged [releases](https://github.com/iLevyTate/ai-job-search/releases) of this repo over raw `master`. `python3 tools/check_upstream_updates.py` previews which personalized files an update touches. Walkthrough in [SETUP.md, section 8](SETUP.md#8-pulling-upstream-updates-into-your-fork).

## Tips

A thin profile produces generic applications. Describe what you actually did: projects, tools, numbers. Skills in context beat a keyword list.

Two search modes both work: you already know the roles you want, or you want the system to surface paths from the work you have already done. `/setup` is the place to say what energized you and what you want more of.

## Contributing

PRs for this repo go to [iLevyTate/ai-job-search](https://github.com/iLevyTate/ai-job-search). Desk, US boards, and this product's docs land here. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## Acknowledgements

Workflow methodology began in [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search). Portal CLI skills started with [Mikkel Krogholm](https://github.com/mikkelkrogsholm). Runtime is [Claude Code](https://claude.com/claude-code).

## License

MIT
