---
name: add-template
description: >-
  Registers and activates a custom CV (moderncv) or cover letter LaTeX template.
  Triggers on: add template, custom cv template, custom cover letter, register template, /add-template.
---

# /add-template - Register a Custom CV or Cover Letter Template

You are helping the user register their own LaTeX template with the AI Job Search framework.

Follow these steps **in order**.

---

## Step 0: Parse User Input

- If user provided `--list`: list registered templates found in `templates/**/TEMPLATE.md` and display their type, engine, fonts, and active status.
- If user provided `--use <name>`: activate that template in `.agents/skills/job-application-assistant/05-cv-templates.md` (or `06-cover-letter-templates.md`). If `--use default`, remove the active override block.
- If user provided a path or pasted template: proceed to Step 1.
- Otherwise: start registration interview at Step 1.

---

## Step 1: Template Type and Source

Ask the user:
1. **Type:** CV or Cover Letter?
2. **Source:** Path to `.tex` file, pasted LaTeX, or directory with assets.

---

## Step 2: Capture Template Instructions

Collect:
1. **Name** (kebab-case, e.g. `awesome-cv`)
2. **Compile Engine** (`lualatex`, `xelatex`, or `pdflatex`)
3. **Fonts** (bundled in `fonts/` or system fonts)
4. **Style Rules** (colors, sections, bullets, spacing)
5. **Page Limit** (default: 2 pages for CV, 1 page for Cover Letter)

---

## Step 3: Store the Template

Create `templates/<type>/<name>/` containing:
- `template.tex` (with `[PLACEHOLDER]` tokens for personal details)
- Any required `.cls` / `.sty` files
- `fonts/` folder for bundled fonts
- `TEMPLATE.md` manifest

---

## Step 4: Verify the Template Compiles (MANDATORY)

1. Create a temporary `_compile_test.tex` with dummy content.
2. Compile with `<engine>`:
   ```bash
   cd templates/<type>/<name> && <engine> -interaction=nonstopmode _compile_test.tex
   ```
3. Verify layout and page count.
4. Clean up temporary test files (`_compile_test.*`).

---

## Step 5: Activate the Template

Add or update the `ACTIVE-TEMPLATE` managed block in `.agents/skills/job-application-assistant/05-cv-templates.md` (for CVs) or `06-cover-letter-templates.md` (for cover letters).

---

## Step 6: Confirm

Summarize the registered template, engine, fonts, and activation status.
