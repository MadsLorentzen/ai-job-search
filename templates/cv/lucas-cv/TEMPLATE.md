# Template: lucas-cv

- **Type:** CV
- **Engine:** pdflatex
- **Page limit:** 1 page
- **Fonts:** Helvetica via the `helvet` package (system/TeX-distribution font - no bundled files needed)
- **Class/packages:** standard `article` class; `xcolor`, `hyperref`, `enumitem`, `microtype`, `titlesec` (all standard, no custom `.cls`)

## Compile command

    cd cv && pdflatex -interaction=nonstopmode main_<company>_<role>.tex

## Style rules

- Single accent color throughout: `accent` = `#17365D` (dark blue) for headline, section rule/heading, links. `ink` = `#161616` for the name. `muted` = `#555555` for de-emphasized italic notes (e.g. project stack lines, contract-via notes).
- Section order: Summary -> Education -> Activities & Awards -> Skills -> Experience -> Selected Projects -> Languages.
- Name at 26.5pt bold, headline directly below at 12.5pt bold in accent color, then a compact single-line contact block (location, phone, email / linkedin, github, website).
- Use `\entry{Title}{Dates}{Org}{Location}` for Education and Experience entries - title/dates on one line (dates right-aligned via `\hfill`), org/location on the next (also right-aligned).
- Use `\project{Name}{Stack}{Description}` for Selected Projects - name and tech stack on one line, description below. Name should be a `\href` link when the project has a public URL.
- Bold category labels for Skills (e.g. `\textbf{Computer Vision:}`) followed by a comma-separated list.
- Compact spacing throughout (`itemsep=1.1pt`, negative `\vspace` after entries) - this template is intentionally dense to fit 1 page; do not loosen spacing to fill space.
- Bullet lists (3-4 bullets for the most recent role, 2 for older roles) via plain `itemize`, no nested lists.

## Known pitfalls

- This template's natural page limit is **1 page**, not the framework's usual 2-page default. When tailoring for a role, cut content to preserve density rather than trying to stretch to 2 pages.
- `\input{glyphtounicode}` + `\pdfgentounicode=1` are required for ATS text-layer extraction with pdflatex on this template - do not remove them.
- No custom `.cls` or bundled fonts - this keeps the template portable across TeX installs, unlike the stock moderncv setup which needs lualatex for `fontawesome5`.
