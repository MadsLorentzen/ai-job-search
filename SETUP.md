# Setup Guide

Step-by-step instructions for getting the AI Job Search framework running.

## 1. Prerequisites

### Claude Code

Install Claude Code (Anthropic's CLI for Claude):

```bash
npm install -g @anthropic-ai/claude-code
```

You'll need an Anthropic API key or a Claude Pro/Team subscription. See the [Claude Code docs](https://docs.anthropic.com/en/docs/claude-code) for details.

### Python

Python 3.10+ is required for the salary lookup tool. Check with:

```bash
python --version
```

### Bun (for job search tools)

The Danish job portal CLIs are written in TypeScript and run with Bun:

```bash
curl -fsSL https://bun.sh/install | bash
```

### LaTeX (for compiling CVs and cover letters)

You need a LaTeX engine to compile the generated `.tex` files to PDF. There are two supported paths:

**Option A — Tectonic (recommended, no sudo, self-contained).** Tectonic is a single binary that downloads packages on demand, so you don't need a multi-GB TeX install. It is the engine this repo is verified to work with.

- **macOS:** `brew install tectonic`
- **Linux:** `brew install tectonic`, `cargo install tectonic`, or your distro package
- **Windows:** see [tectonic-typesetting.github.io](https://tectonic-typesetting.github.io/)

Compile both document types with the same command: `tectonic <file>.tex`.

**Option B — Full TeX distribution.** If you already have one (or want offline compiling):

- **Windows:** [MiKTeX](https://miktex.org/download)
- **macOS:** [MacTeX](https://tug.org/mactex/)
- **Linux:** `sudo apt install texlive-full` or `sudo dnf install texlive-scheme-full`

With a full install, compile the CV with `lualatex` (pdflatex often fails on modern MiKTeX with `fontawesome5` font-expansion errors) and the cover letter with `xelatex` (`cover.cls` requires `fontspec`).

> **Two patches are checked into this repo to make moderncv compile under Tectonic** (both already present, nothing to do):
> 1. A patched `fontawesome5-utex-helper.sty` sits in `cv/` and `cover_letters/`. The stock version hangs Tectonic by iterating glyphs via `\XeTeXglyphname`; the patch skips that loop and pre-defines the icon macros moderncv needs. **Do not delete these files.**
> 2. The Tectonic package bundle ships moderncv 2022, which colours the name/section headings natively and has no `\firstnamestyle`/`\lastnamestyle`/`\sectionstyle` commands. So those `\renewcommand*` overrides are omitted in the generated CVs, and `\hypersetup` is wrapped in `\AtBeginDocument{}` to avoid a hyperref option clash.
>
> Harmless warnings to ignore under Tectonic: "Creating ToUnicode CMap failed for FontAwesome5..." and overfull/underfull hbox warnings. Icons render fine; only the PDF's copy-paste text layer shows garbled characters for the contact icons.

## 2. Fork and clone

```bash
gh repo fork MadsLorentzen/ai-job-search --clone
cd ai-job-search
```

Or manually: fork on GitHub, then clone your fork.

## 3. Install job search CLI dependencies

```bash
for tool in jobbank-search jobdanmark-search jobindex-search jobnet-search; do
  cd .agents/skills/$tool/cli && bun install && cd ../../../..
done
```

## 4. Run the setup interview

Start Claude Code in the repository:

```bash
claude
```

Then run the onboarding:

```
/setup
```

Claude will offer two paths:

- **Path A (recommended):** Share your existing CV (mention the file with `@` or paste the text). Claude extracts your information and asks follow-up questions for anything missing.
- **Path B:** Answer structured interview questions section by section.

Both paths produce the same result: fully populated profile files.

### What gets populated

| File | Content |
|------|---------|
| `CLAUDE.md` | Your full candidate profile |
| `01-candidate-profile.md` | Structured education, experience, skills |
| `02-behavioral-profile.md` | Behavioral assessment |
| `04-job-evaluation.md` | Personalized skill match areas and career goals |
| `05-cv-templates.md` | Profile statement templates for your background |
| `07-interview-prep.md` | STAR examples from your experience |
| `cv/main_example.tex` | Your LaTeX CV with actual details |
| `search-queries.md` | Job search queries for `/scrape` |

### Re-running setup

You can update specific sections later:

```
/setup --section skills
/setup --section experience
/setup --section search
```

The `--section search` option is especially useful as your priorities evolve. It re-runs the search configuration interview and suggests role types you may not have considered based on your full profile.

## 5. Optional: Set up salary benchmarking

If you have salary data (from a union, salary survey, Glassdoor, or personal research):

1. **Option A:** Create `salary_data.json` manually in the repo root (see `tools/README_SALARY_TOOL.md` for the format)
2. **Option B:** Convert from Excel:
   ```bash
   pip install openpyxl
   python tools/convert_salary_excel.py path/to/salary-data.xlsx --source "My Salary Data 2025"
   ```

This creates `salary_data.json` which the `/apply` workflow uses for salary benchmarking. If you skip this step, salary lookup is simply omitted.

## 6. Test the workflow

Find a job posting you're interested in, then:

```
/apply https://jobindex.dk/job/1234567
```

Or paste the job description directly:

```
/apply [paste job posting text here]
```

Claude will:
1. Evaluate the fit against your profile
2. Ask if you want to proceed
3. Draft a tailored CV and cover letter
4. Have a reviewer agent critique the drafts
5. Revise and present the final output

## 7. Compile your documents

After `/apply` creates the LaTeX files:

```bash
# Tectonic (recommended) — same command for both:
cd cv && tectonic main_<company>.tex && cd ..
cd cover_letters && tectonic cover_<company>_<role>.tex && cd ..

# Full TeX install alternative:
# cd cv && lualatex main_<company>.tex && cd ..
# cd cover_letters && xelatex cover_<company>_<role>.tex && cd ..
```

## Troubleshooting

### "salary_data.json not found"
This is expected if you haven't set up salary benchmarking. The `/apply` workflow skips this step automatically.

### Job search CLI tools not working
Make sure Bun is installed and you ran `bun install` in each CLI directory. The tools require network access to fetch job listings.

### LaTeX compilation errors
- **Recommended engine: `tectonic`** (`brew install tectonic`). Same command for CV and cover letter: `tectonic <file>.tex`. It auto-downloads packages, so a missing-package error usually just means the first run needs network access.
- **Tectonic hangs/aborts (exit 134) on the CV:** caused by the stock `fontawesome5-utex-helper.sty` iterating glyphs via `\XeTeXglyphname`. The repo ships a patched copy in `cv/` and `cover_letters/` that fixes this. If compiling a CV in a new directory, copy that `.sty` alongside it.
- **`Command \firstnamestyle undefined`:** you are on Tectonic's moderncv 2022, which has no such command. Remove the `\firstnamestyle`/`\lastnamestyle`/`\sectionstyle` overrides (moderncv 2022 colours the name and headings natively).
- **`Option clash for package hyperref`:** moderncv loads hyperref itself; move your `\hypersetup{...}` into `\AtBeginDocument{}`.
- **Full TeX install instead of Tectonic:** CV uses `lualatex` (pdflatex often fails on modern MiKTeX with `fontawesome5` font-expansion errors); cover letter uses `xelatex` (custom fonts in `OpenFonts/fonts/`). Make sure the distribution includes the `moderncv` package.

### Fonts not found in cover letter
The cover letter template expects fonts in `cover_letters/OpenFonts/fonts/`. Make sure this directory exists and contains the Lato and Raleway font files.
