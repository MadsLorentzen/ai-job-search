# Template: medium-length-professional-cv

- **Type:** CV
- **Engine:** pdflatex
- **Page limit:** 2 page(s)
- **Fonts:** EB Garamond (system font via the `ebgaramond` package - standard TeX Live package with bundled Type 1 files, no separate font files needed)
- **Class/packages:** custom `resume.cls` (bundled, based on `article`) + `parskip`, `array`, `ifthen`, `graphicx`, `geometry`, `ebgaramond`

## Compile command

    cd cv && pdflatex -interaction=nonstopmode main_<company>.tex

(Copy `resume.cls` into the same directory as the filled-in `.tex` file.)

## Style rules

- Centered, large uppercase name at the very top, auto-printed by the class (do not add your own `\maketitle`-style heading).
- Up to 3 `\address{...}` calls print as centered lines below the name, in call order. A `\\` *inside* an `\address{}` argument is redefined to render as a `$\diamond$` separator, not a real line break - keep each `\address{}` call to what should visually read as one line (e.g. one call for location, one for phone+email, one for LinkedIn).
- Each major section uses `\begin{rSection}{Title}...\end{rSection}` - title auto-uppercases, with a horizontal rule under it.
- Each job uses `\begin{rSubsection}{Company}{Dates}{Job Title}{Location}...\end{rSubsection}`, followed by `\item` bullets (uses a custom tight-spacing list, not a plain `itemize`). Pass an empty 3rd argument (`{}`) to suppress the job-title/location line entirely for a compact entry.
- Skills/strengths section uses a plain `tabular` with bold left column - see the Skills section in `template.tex` for the pattern.
- No page numbers (`\pagestyle{empty}`).
- Source: https://www.latextemplates.com/template/medium-length-professional-cv (original by Trey Hunner, modified by Vel/LaTeXTemplates.com). Licensed CC BY-NC-SA 4.0 - noncommercial use only, keep attribution comments in the files.

## Known pitfalls

- The `\address{...}` mechanism only has 3 slots (`@addressone`/`@addresstwo`/`@addressthree`). A 4th `\address{}` call silently **overwrites** the 3rd slot instead of erroring - if a 4th contact line seems to be missing, check for more than 3 `\address` calls before debugging anything else.
- `&` is catcode-4 (the alignment character) throughout standard LaTeX, not just inside `tabular` - a literal `&` in a section title, a bullet, or anywhere outside an alignment environment throws `Misplaced alignment tab character &`, and inside the Skills `tabular` it throws `Extra alignment tab has been changed to \cr` instead (silently shifting columns). Always escape as `\&` (e.g. "R\&D", "Awards \& Publications").
- The all-caps name line (`\MakeUppercase{\huge\bfseries\name}`) produces a mild "Overfull \hbox" warning even with a short two-word name at the stock font size - cosmetic only in testing, but re-check for actual visual overflow/clipping with longer names and reduce to `\Large` if needed.
- `rSubsection`'s bullet list uses `\setlength{\itemsep}{-0.5em}` (negative item separation) for a tight look - if bullets ever look overlapped rather than tight, this is the length to adjust, not the section's outer spacing.
