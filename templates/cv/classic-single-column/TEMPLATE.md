# Template: classic-single-column

- **Type:** CV
- **Engine:** xelatex (or pdflatex)
- **Page limit:** exactly 1 page (or 2 pages if expanded)
- **Fonts:** Standard TeX Gyre / Computer Modern (system / default distribution)
- **Class/packages:** article, geometry, hyperref, tabularx

## Compile command

    cd cv && xelatex -interaction=nonstopmode main_<company>.tex

## Style rules

- Single-column ATS-friendly layout with clean horizontal divider rules under section titles.
- **Mandatory Hyperlinks:** Always include clickable hyperlinks (`\href{...}{\underline{...}}`) for:
  - Email (`mailto:nbhatnagar3010@gmail.com`)
  - LinkedIn (`https://www.linkedin.com/in/nehulbhatnagar`)
  - Research Papers / Publications (e.g. arXiv link `https://arxiv.org/abs/2602.07248`)
  - GitHub / Project repositories
- Header: Centered full name in LARGE bold, contact and links on second line separated by vertical bars.
- Work experience: Title bold left, Dates right; Company bold left, Location italic right; italic summary subtitle under role.
- Bullets: Tight spacing with `\resumeItem{...}`.
- Skills: Grouped into categorized lines (Languages & Frameworks, Machine Learning & LLMs, Backend & Infrastructure, Data & Distributed Systems).

## Known pitfalls

- None recorded. Zero external package requirements; compiles cleanly with standard BasicTeX/MacTeX installations.
