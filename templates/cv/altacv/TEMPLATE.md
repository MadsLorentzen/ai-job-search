# Template: altacv

- **Type:** CV
- **Source extension:** .tex
- **Engine/toolchain:** lualatex (xelatex also works with `-shell-escape -output-driver="xdvipdfmx -z 0"`)
- **Page limit:** 2 pages
- **Fonts:** Lato (sans, system font) + Roboto Slab (serif, system font). Both available as system TrueType fonts on this machine. No bundled font files needed.
- **Class/packages:** `altacv.cls` (v1.7.4, bundled in this folder) + `paracol`, `fontawesome5`, `simpleicons` (TeX Live standard). No biblatex/biber in the skeleton (publications block removed; profile has no peer-reviewed papers).

## Compile command

    cd <output dir> && lualatex -interaction=nonstopmode <file>.tex

## Style rules

- Two-column paracol layout, 0.6:0.4 left:right width ratio (`\columnratio{0.6}`). Left column = Experience/Education/Certifications; right column = Profile/Competencies/Languages/Referees.
- Colours: PastelRed accent (`#8F0D0D`), DarkPastelRed headings (`#450808`), GoldenEarth heading rules (`#E7D192`), SlateGrey emphasis, LightGrey body. Do not recolour unless the target employer's brand demands it.
- Headings: `\cvsectionfont` = LARGE rmfamily bfseries. Body default = Lato sans (`\familydefault` = `\sfdefault`).
- Use `\cvsection{...}` for sections, `\cvevent{title}{org}{date}{location}` for entries, `\divider` between entries, `\cvtag{...}` for skill chips (avoid overuse; comma-separated lists are fine too), `\cvskill{lang}{N}` for language level (supports X.5).
- **Date format in `\cvevent`:** use explicit numeric ranges with single ASCII hyphens: `01.2016 - heute`, `04.2014 - 12.2015`, `2010 - 2013`. Do NOT use `--` (renders as a U+2013 en-dash, which ATS parsers can mangle — this repo's date convention per commit #276) and prefer numeric months over `Jan 2016`/`Dez 2015` style so the text layer extracts cleanly.
- **Umlauts:** write UTF-8 umlauts directly (`für`, `Möglichkeiten`, `Verfügbar`). babel-style shorthands (`f"ur`, `M"oglichkeiten`) render literally as `"o` etc. because the skeleton loads neither babel nor polyglossia.
- No photo: the `\photoR{...}` line is commented out in the skeleton because no image asset is shipped. Uncomment and supply a photo file only if one is available.

## Known pitfalls

- **Photo asset missing:** the upstream `sample.tex` calls `\photoR{2.8cm}{Globe_High}` referencing an image that is not shipped. This skeleton removes that line. Do not re-add a `\photo` call unless you place the image file in the compile directory.
- **`pdflatex` will fail:** the skeleton uses `\iftutex` + `\setmainfont`/`\setsansfont`, which only resolve under xelatex/lualatex. Always compile with lualatex (or xelatex).
- **biblatex removed:** the upstream sample uses `\input{pubs-num}` + `\addbibresource{sample.bib}` + `\printbibliography`, which require a biber pass. This skeleton drops all of that since the candidate profile has no peer-reviewed publications. Re-add only if real `.bib` entries exist.
- **Section headings must match the CV's language:** `\cvsection{...}` headings are literal text, not auto-translating. For a German CV, use German section titles (e.g. `Berufserfahrung`, `Ausbildung`, `Zertifizierungen \& Auszeichnungen`, `Profil`, `Kernkompetenzen`, `Sprachen`, `Referenzen`) - this is the same rule as the stock moderncv template.
- **`\medskip` in horizontal mode:** a `\medskip` immediately followed on the next line by `\cvsection{...}` (or `\switchcolumn`) fails with `You can't use \prevdepth in horizontal mode.` Always leave a blank line between `\medskip` and the following `\cvsection` / `\switchcolumn` so the paragraph boundary is closed before the section command's `\nointerlineskip` fires. (Confirmed during template registration, 2026-08.)
- **`\cvtag` chips on one line:** several `\cvtag{...}\cvtag{...}\\` calls on a single line also contribute to the horizontal-mode state before `\medskip`/`\cvsection`; keep the blank-line rule above and it compiles fine.
