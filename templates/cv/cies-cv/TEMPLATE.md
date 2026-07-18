# Template: cies-cv

- **Type:** CV
- **Engine:** pdflatex
- **Page limit:** 2 page(s)
- **Fonts:** TeX Gyre Pagella (system font via the `tgpagella` package - standard in TeX Live, no bundled files needed)
- **Class/packages:** `article` base class + `structure.tex` (bundled); requires `geometry`, `multicol`, `mdwlist`, `relsize`, `hyperref`, `xcolor`, `tgpagella`, `fontenc`, `microtype`

## Compile command

    cd cv && pdflatex -interaction=nonstopmode main_<company>.tex

(Copy `structure.tex` into the same directory as the filled-in `.tex` file - it's `\include`d by name.)

## Style rules

- Two-column `Summary` block right under the name/contact line - use this for a narrative paragraph (interests, achievements, trajectory) that doesn't fit as bullets elsewhere. Keep it to 2-4 sentences per column.
- Content organized by **employer**, not by role: use one `\headedsection` per employer, with one `\headedsubsection` per position held there (supports showing progression within the same company without repeating the employer name).
- Links and section markers render in dark blue (`dark-blue` color, defined in `structure.tex`); do not override this per-application.
- No page numbers (`\pagestyle{empty}`).
- `\acr{...}` renders text in a slightly reduced small-caps-like scale - use for acronyms (e.g. `\acr{API}`) to keep them from dominating the line.
- Bullet separator between contact items is `\bull`, not literal `•` or `|`.
- Source: https://www.latextemplates.com/template/cies-cv (original template by Cies Breijs, https://github.com/cies/resume, modified by Vel/LaTeXTemplates.com). Licensed CC BY-NC-SA 3.0 - noncommercial use only, keep attribution comments in the files.

## Known pitfalls

- `structure.tex` is pulled in with `\include`, which requires `structure.tex` to sit in the **same working directory** as the compiled `.tex` file (or on the include path) - copy it alongside every `main_<company>.tex` that uses this template.
- `\headedsection{...}{...}{...}` and `\headedsubsection{...}{...}{...}` both take **exactly 3 arguments** - the third is the body content (usually one or more `\bodytext{}` blocks). Leaving it as an empty `{}` is fine (e.g. for education entries with no extra detail), but dropping the argument entirely unbalances the braces and produces a cascade of `Missing \endcsname inserted` errors that look unrelated to the real cause.
- `relsize` prints a harmless `Font size 40.0pt is too large` warning when compiling the name/title line at this template's default sizing - cosmetic only, not a real error.
- No explicit page-break protection (no `\needspace`/`\nopagebreak` guard beyond the built-in `\nopagebreak[4]` in each macro) - for long content, re-check for orphaned `\headedsection` titles near a page boundary and add manual `\clearpage`/`\vspace` if needed.
