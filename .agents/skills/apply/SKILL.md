---
name: apply
description: >-
  Orchestrates the complete job application workflow: fit evaluation, salary benchmarking,
  CV & cover letter drafting, reviewer critique, PDF compilation & inspection, ATS verification,
  and interview talking points.
  Triggers on: apply, job application, draft cv, cover letter, tailor resume, /apply.
---

# /apply - Job Application Workflow

You are orchestrating the end-to-end job application workflow. The job posting is provided by the user (as a URL or pasted text).

Follow these steps **exactly in order**. Do not skip steps.

---

## Step 0: Parse Input

- If the input looks like a URL, use `read_url_content` or `curl` to retrieve the job posting content.
- If it is pasted text, use it directly.
- Extract: **company name**, **role title**, **department** (if mentioned), **location**, and **language** of the posting.
- Store these for use throughout the workflow.

---

## Step 1: DRAFTER - Evaluate Fit

Read the evaluation framework:
- `.agents/skills/job-application-assistant/04-job-evaluation.md`
- `.agents/skills/job-application-assistant/01-candidate-profile.md`

Using the framework from `04-job-evaluation.md`, evaluate the job posting against the candidate's profile. If the salary lookup tool is configured, run:

```bash
conda run -n ai-job-search python salary_lookup.py "<Company Name>" --json
```

If the posting specifies a city, add `--city "<City>"`. Parse the JSON output and include the salary benchmark in the evaluation. If the tool is not configured or returns an error, skip the salary benchmark.

Present the evaluation to the user with:
1. **Skills match** - which required/preferred skills match vs. gaps
2. **Experience match** - how work history maps to the role
3. **Behavioral/culture match** - how behavioral profile fits the role/company culture
4. **Salary benchmark** - salary index for the company (if available)
5. **Overall fit score** and recommendation (strong fit / moderate fit / weak fit)

After presenting the evaluation, ask the user:
> "Should I proceed with drafting the CV and cover letter for this role?"

**If the user says no, stop here.** If yes, continue to Step 2.

---

## Step 2: DRAFTER - Draft CV + Cover Letter

Read reference files:
- `.agents/skills/job-application-assistant/03-writing-style.md`
- `.agents/skills/job-application-assistant/05-cv-templates.md`
- `.agents/skills/job-application-assistant/06-cover-letter-templates.md`

Also read the most recent existing CV and cover letter files for structural reference:
- Read any existing `cv/main_*.tex` file as a LaTeX template reference
- Read any existing `cover_letters/cover_*.tex` file as a template reference

### CV (`cv/main_<company>.tex`)
- Always in **English**
- Follow the moderncv/banking format from `05-cv-templates.md`
- Tailor the profile statement and experience bullets to the specific role
- Reframe skills and achievements to match job requirements
- Keep to 2 pages

### Cover Letter (`cover_letters/cover_<company>_<role>.tex`)
- **Match the language of the job posting** (write in the language the posting uses)
- Follow the structure from `06-cover-letter-templates.md`
- Use the `cover.cls` template
- Tailor the opening paragraph to the specific role and company
- Address to a named person if available, otherwise "Dear Hiring Manager"
- Keep to approximately one page

Write both files to disk.

---

## Step 3: REVIEWER - Research & Critique

Review the draft critically against the role requirements and company context:
1. **Research Company**: Check company website, mission, and culture.
2. **Read Reference Materials**: Check `01-candidate-profile.md`, `02-behavioral-profile.md`, `03-writing-style.md`, `04-job-evaluation.md`.
3. **Produce Structured Edits**: Produce concrete replacements for keywords, department angles, and style refinements.
4. **Factual Grounding**: Ensure no skills, roles, or achievements are fabricated.

---

## Step 4: DRAFTER - Revise Based on Feedback

Apply the structured edits and narrative suggestions directly to `cv/main_<company>.tex` and `cover_letters/cover_<company>_<role>.tex`.

---

## Step 5: DRAFTER - Compile & Inspect PDFs (MANDATORY)

**Never skip this step.** Compile both documents and verify layout:

### 5a. Compile
```bash
cd cv && lualatex -interaction=nonstopmode main_<company>.tex
cd ../cover_letters && xelatex -interaction=nonstopmode cover_<company>_<role>.tex
```
*(If `lualatex` or `xelatex` is not installed on the system, notify the user with installation commands: `brew install --cask basictex`).*

### 5b. Inspect Layout
- **CV (`cv/main_<company>.pdf`):** Exactly 2 pages, no orphaned titles (`\needspace{5\baselineskip}`), clean margins.
- **Cover Letter (`cover_letters/cover_<company>_<role>.pdf`):** Exactly 1 page, signature block visible, matching Raleway body font.

### 5c. ATS & Keyword Verification (CV)
Extract text layer with `pdftotext -layout main_<company>.pdf main_<company>.txt` (if `pdftotext` is installed via `brew install poppler`):
- Clean text extraction (no garbage tokens)
- Literal contact text present
- Reading order is single-column correct
- Keyword coverage table reported

Clean up `.aux`, `.log`, `.out`, and temporary `.txt` files.

---

## Step 6: Present Final Output & Verification Checklist

Report the pass/fail verification checklist from `AGENTS.md`:
- [ ] Factual accuracy against profile
- [ ] Targeting & keyword match
- [ ] Document consistency & formatting
- [ ] Quality, grammar, and style guidelines
- [ ] Hyperlinks active and formatted: research paper (arXiv URL), email (`mailto:`), LinkedIn, GitHub
- [ ] Compiled PDF verification (1 page for single-column CV / 2 pages if expanded, 1 page for Cover Letter)
