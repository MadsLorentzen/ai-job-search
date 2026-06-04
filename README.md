<p align="center">
  <img src="ai_job_search_animation.gif" alt="Codex Job Search Assistant" width="200">
</p>

# AI Job Search

An AI-powered job application framework built on [Codex](https://developers.openai.com/codex/quickstart). Fork it, fill in your profile, and let Codex evaluate job postings, tailor your CV, write cover letters, and prepare you for interviews.

## What this is

A structured workflow that turns Codex into a full-stack job application assistant. The core workflow (self-profiling, fit evaluation, and the drafter-reviewer application pipeline) is **language- and country-agnostic**. The search workflow is tuned for Portugal, EU remote roles, LinkedIn, company career pages, and relevant web searches rather than bundled job-board scripts.

```
$job-setup          $job-scraper              $job-apply <url>
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
               -> $job-apply            -> Revise -> Final output
```

The framework encodes career guidance best practices, including structured evaluation criteria, forward-looking cover letter framing, and optional salary benchmarking.

## Prerequisites

- [Codex](https://developers.openai.com/codex/quickstart) (CLI)
- Python 3.10+
- LaTeX distribution with `lualatex` and `xelatex`: [TeX Live](https://tug.org/texlive/) or [MiKTeX](https://miktex.org/). The CV compiles with `lualatex` (pdflatex often fails on modern MiKTeX installs with `fontawesome5` font-expansion errors); the cover letter compiles with `xelatex` because `cover.cls` requires `fontspec`.

## Quick start

### 1. Fork and clone

```bash
gh repo fork MadsLorentzen/ai-job-search --clone
cd ai-job-search
```

### 2. Set up your profile

```bash
codex
# Then ask Codex:
$job-setup
```

`$job-setup` offers three paths: read your `documents/` folder if you have one populated (CV PDF, LinkedIn export, diplomas, reference letters, past applications), import a single CV pasted in chat, or walk through an interview. It auto-detects what you have and asks. Documents-folder mode is idempotent and safe to re-run as you add more material; see `documents/README.md` for the layout.

### 3. Search for jobs

```bash
$job-scraper
```

This searches multiple job portals for positions matching your profile, deduplicates results, and presents them sorted by fit. Pick a match to run `$job-apply` on it directly.

### 4. Apply to a job

```bash
$job-apply https://www.linkedin.com/jobs/view/123456789
```

If the URL can't be fetched (some job portals block automated access), you can paste the job description directly instead:

```bash
$job-apply <paste the full job description here>
```

This runs the full workflow: evaluate fit, draft CV + cover letter, review with a second agent, revise, and present the final output.

## Other commands

`$job-setup`, `$job-scraper`, and `$job-apply` form the core workflow. Two more commands extend it once your profile is in place:

- **`$profile-expand`** enriches your profile by scanning public sources you've already linked in it (GitHub repos, portfolio site, Kaggle, Google Scholar) and looking up syllabi for named courses and certifications. Discovered competencies are added to your profile with a source tag. Useful right after `$job-setup` to surface skills that documents alone don't make explicit.
- **`$upskill`** analyzes the gap between your profile and your tracked job postings (or a single posting via `$upskill <URL>`). Produces a prioritized heatmap of skill gaps and a learning plan with web-searched study resources and time estimates. Useful for career planning between applications.

`$profile-reset` is also available, see [Starting over](#starting-over) below.

## File structure

```
ai-job-search/
|-- AGENTS.md                         # Main candidate profile + workflow rules
|-- .agents/
|   `-- skills/
|       |-- job-apply/                # Full application workflow skill
|       |-- job-setup/                # Profile onboarding skill
|       |-- profile-expand/           # Competency enrichment skill
|       |-- profile-reset/            # Reset profile/documents skill
|       |-- job-application-assistant/# Core application reference skill
|       |-- job-scraper/              # Job search orchestration
|       `-- upskill/                  # Skill gap analysis and learning plan
|-- cv/
|   `-- main_example.tex              # moderncv LaTeX template
|-- cover_letters/
|   |-- cover.cls                     # Custom cover letter LaTeX class
|   `-- OpenFonts/                    # Lato + Raleway fonts
|-- documents/                        # Career source materials
|-- salary_lookup.py                  # Salary benchmarking tool (BYO data)
|-- tools/                            # Salary data conversion docs/scripts
|-- job_scraper/                      # Scraper state (seen jobs, results)
|-- upskill/                          # $upskill report output
|-- job_search_tracker.csv            # Application tracking spreadsheet
`-- SETUP.md                          # Detailed setup guide
```

## How `$job-apply` works

The `$job-apply` command runs a **drafter-reviewer workflow** with mandatory PDF compilation:

1. **Parse** the job posting (URL or text)
2. **Evaluate fit** against your profile (skills, experience, culture, location, career alignment)
3. **Draft** a tailored CV and cover letter in LaTeX
4. **Spawn a reviewer agent** that researches the company and critiques the drafts
5. **Revise** based on the reviewer's feedback
6. **Compile and inspect** both PDFs: lualatex for the CV, xelatex for the cover letter. Codex reads the rendered pages and iterates on the LaTeX until the CV is exactly 2 pages with no orphaned entry titles, and the cover letter is exactly 1 page with the signature visible and fonts consistent.
7. **Present** the final output with a verification checklist

All claims in the CV and cover letter are verified against your actual profile. The system never fabricates skills or experience.

### What makes this workflow different

- **PDF verification loop.** Most LaTeX-resume templates produce "looks fine in the .tex" output that breaks in the PDF: job titles orphan to the next page, cover letters spill onto page 2, bullet fonts silently fall back to the body font. The `$job-apply` command compiles and visually inspects every PDF and applies targeted fixes (`\needspace`, `\enlargethispage`, font-matching wrappers for list items) until the layout is clean. This runs automatically on every application.
- **Relevance-weighted CV cutting.** When a CV overflows 2 pages, the workflow does not cut mechanically from the "oldest" section. It scores each candidate line by (a) relevance to the target posting, (b) uniqueness in the document, and (c) whether the cover letter depends on it, and cuts the lowest-total-score line first. An older-role bullet that hits posting keywords survives ahead of a recent-role bullet that does not.
- **Drafter-reviewer separation.** The drafter writes; a second Codex agent, spawned with a fresh context, researches the company and critiques the drafts. The drafter then revises. This catches missed keywords, weak framing, and generic language that a single pass often leaves in.
- **Token-efficient reviewer dispatch.** The reviewer agent receives drafts inline rather than re-reading them, and the verification checklist runs once at the end of the workflow rather than being duplicated by both agents. Note: the new compile-and-inspect step in Step 5 spends some of those savings on PDF rendering and layout iteration - the workflow trades some end-to-end token cost for a real reduction in broken PDFs reaching the user.

## Customization

### Which files to edit manually

If you prefer editing files directly instead of using `$job-setup`:

| File | What to change |
|------|---------------|
| `AGENTS.md` | Your full profile (name, education, experience, skills, goals) |
| `01-candidate-profile.md` | Structured version of your CV data |
| `02-behavioral-profile.md` | Your behavioral assessment or self-assessment |
| `04-job-evaluation.md` | Skill match areas, career goals, motivation filters |
| `05-cv-templates.md` | Profile statement templates for different role types |
| `07-interview-prep.md` | Your STAR examples from actual experience |
| `search-queries.md` | Job search queries for your skills and location |

### Updating your search queries

As your priorities evolve, you can reconfigure just the job search without re-running the full profile setup:

```
$job-setup --section search
```

This re-runs the search configuration interview: which roles to target, which skills to search for, which locations, and which portals. It also suggests role types you may not have considered based on your profile.

### LaTeX templates

The CV uses [moderncv](https://ctan.org/pkg/moderncv) (banking style). The cover letter uses a custom `cover.cls` with Lato/Raleway fonts. You can replace these with your own templates; just update the guidance in `05-cv-templates.md` and `06-cover-letter-templates.md`.

### Job Search Sources

The search workflow uses LinkedIn, company career pages, Portugal-friendly job boards, EU remote boards, and general web search. Edit `.agents/skills/job-scraper/search-queries.md` to tune preferred sites, cities, remote constraints, and target companies.

### Salary Benchmarking

The salary tool works with any EUR salary data you provide (Portuguese salary surveys, Glassdoor/Teamlyzer notes, public ranges, networking notes, or personal research). See `tools/README_SALARY_TOOL.md` for the expected format and setup. If you don't have salary data, the salary step is simply skipped.

### Starting over

To wipe your profile data and start fresh:

```
$profile-reset profile    # clears skill files, preserves framework rules
$profile-reset documents  # deletes files from documents/ folder
$profile-reset all        # both
```

`$profile-reset` shows exactly what will be deleted and requires you to type `RESET` to confirm. Nothing is deleted until you do.

## Tips for better results

### Profile depth matters

The single biggest factor in output quality is how much detail you put into your profile. A thin profile produces generic applications; a detailed one enables genuinely tailored results.

- **Role descriptions:** Don't just list job titles. Describe what you actually did in each position: specific projects, tools used, responsibilities, and measurable achievements. The more material you provide, the more precisely the system can reframe your experience for different roles.
- **Skills in context:** Instead of listing "Python" or "project management," describe how and where you applied them. "Built ML pipelines for customer churn prediction in Python using scikit-learn" gives the system far more to work with than "Python, machine learning."
- **All onboarding paths work:** Whether you point `$job-setup` at your `documents/` folder, paste a single CV, or walk through the interview, the principle is the same: richer input produces sharper output.

### Career path discovery

The framework supports two distinct modes of job searching:

- **Explicit targeting:** You know which roles or sectors you want. The system helps refine and prioritize based on fit.
- **Latent opportunity discovery:** By analyzing your full history (not just job titles, but the actual work you did), the system can surface career paths you haven't considered. Transferable skills that map to unexpected industries, patterns in what you enjoyed or excelled at, or emerging roles that combine your domain expertise with new technology.

To get the most from this, invest time during `$job-setup` in describing not just your experience, but what energized you, what drained you, and what you'd want more of. This context directly shapes how the system evaluates fit and which roles it surfaces during `$job-scraper`.

## Acknowledgements

- Built with [Codex](https://developers.openai.com/codex/quickstart) by [OpenAI](https://openai.com)

## License

MIT

