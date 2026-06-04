# Setup Guide

Step-by-step instructions for getting the AI Job Search framework running.

## 1. Prerequisites

### Codex

Install Codex (OpenAI's CLI for Codex):

```bash
npm install -g @openai/codex
```

You'll need an OpenAI API key or a Codex Pro/Team subscription. See the [Codex docs](https://developers.openai.com/codex/quickstart) for details.

### Python

Python 3.10+ is required for the salary lookup tool. Check with:

```bash
python --version
```

### LaTeX (for compiling CVs and cover letters)

Install a LaTeX distribution to compile the generated `.tex` files to PDF:

- **Windows:** [MiKTeX](https://miktex.org/download)
- **macOS:** [MacTeX](https://tug.org/mactex/)
- **Linux:** `sudo apt install texlive-full` or `sudo dnf install texlive-scheme-full`

The CV compiles with `lualatex` (pdflatex often fails on modern MiKTeX installs with `fontawesome5` font-expansion errors). The cover letter compiles with `xelatex` because `cover.cls` requires `fontspec` for its custom Lato/Raleway fonts.

## 2. Fork and clone

```bash
gh repo fork MadsLorentzen/ai-job-search --clone
cd ai-job-search
```

Or manually: fork on GitHub, then clone your fork.

## 3. Run the setup interview

Start Codex in the repository:

```bash
codex
```

Then run the onboarding:

```
$job-setup
```

Codex will offer two paths:

- **Path A (recommended):** Share your existing CV (mention the file with `@` or paste the text). Codex extracts your information and asks follow-up questions for anything missing.
- **Path B:** Answer structured interview questions section by section.

Both paths produce the same result: fully populated profile files.

### What gets populated

| File | Content |
|------|---------|
| `AGENTS.md` | Your full candidate profile |
| `01-candidate-profile.md` | Structured education, experience, skills |
| `02-behavioral-profile.md` | Behavioral assessment |
| `04-job-evaluation.md` | Personalized skill match areas and career goals |
| `05-cv-templates.md` | Profile statement templates for your background |
| `07-interview-prep.md` | STAR examples from your experience |
| `cv/main_example.tex` | Your LaTeX CV with actual details |
| `search-queries.md` | Job search queries for `$job-scraper` |

### Re-running setup

You can update specific sections later:

```
$job-setup --section skills
$job-setup --section experience
$job-setup --section search
```

The `--section search` option is especially useful as your priorities evolve. It re-runs the search configuration interview and suggests role types you may not have considered based on your full profile.

## 4. Optional: Set up EUR salary benchmarking

If you have salary data (from Portuguese salary surveys, Glassdoor, Teamlyzer, public ranges, networking notes, or personal research):

1. **Option A:** Create `salary_data.json` manually in the repo root (see `tools/README_SALARY_TOOL.md` for the format)
2. **Option B:** Convert from Excel:
   ```bash
   pip install openpyxl
   python tools/convert_salary_excel.py path/to/salary-data.xlsx --source "My EUR Salary Data 2026"
   ```

This creates `salary_data.json` which the `$job-apply` workflow uses for salary benchmarking. If you skip this step, salary lookup is simply omitted.

## 5. Test the workflow

Find a job posting you're interested in, then:

```
$job-apply https://www.linkedin.com/jobs/view/123456789
```

Or paste the job description directly:

```
$job-apply [paste job posting text here]
```

Codex will:
1. Evaluate the fit against your profile
2. Ask if you want to proceed
3. Draft a tailored CV and cover letter
4. Have a reviewer agent critique the drafts
5. Revise and present the final output

## 6. Compile your documents

After `$job-apply` creates the LaTeX files:

```bash
# Compile CV
cd cv && lualatex main_<company>.tex && cd ..

# Compile cover letter
cd cover_letters && xelatex cover_<company>_<role>.tex && cd ..
```

## Troubleshooting

### "salary_data.json not found"
This is expected if you haven't set up salary benchmarking. The `$job-apply` workflow skips this step automatically.

### Job search returns weak results
Update `.agents/skills/job-scraper/search-queries.md` with better target titles, Portugal/EU remote constraints, preferred sites, and companies you want to monitor.

### LaTeX compilation errors
- CV: uses `lualatex` (pdflatex often fails on modern MiKTeX with `fontawesome5` font-expansion errors; lualatex handles the same sources cleanly)
- Cover letter: uses `xelatex` (for custom fonts in `OpenFonts/fonts/`)
- Make sure your LaTeX distribution includes the `moderncv` package

### Fonts not found in cover letter
The cover letter template expects fonts in `cover_letters/OpenFonts/fonts/`. Make sure this directory exists and contains the Lato and Raleway font files.

