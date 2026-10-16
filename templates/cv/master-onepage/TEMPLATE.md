# Template: master-onepage

- **Type:** CV
- **Source extension:** .tex
- **Engine/toolchain:** lualatex
- **Page limit:** 1 page
- **Fonts:** Calibri (system font, not bundled - it is licensed). Resolution order: installed system font `Calibri` -> Microsoft Word's copy at `/Applications/Microsoft Word.app/Contents/Resources/DFonts/` -> metric-identical open fallback `Carlito` (ships with TeX Live). Line breaks are identical under Carlito; glyph shapes differ slightly.
- **Class/packages:** `extarticle` (9pt) with fontspec, geometry, xcolor, hyperref, ulem, enumitem - all standard TeX Live

## Compile command

    cd cv/<company> && rm -f <file>.pdf && mkdir -p build && lualatex -interaction=nonstopmode -output-directory=build <file>.tex && mv build/<file>.pdf ./

## Style rules

Rebuilt from the candidate's master CV (`documents/cv/Mohit_Notani_Master_Resume.docx.pdf`, a Google Docs export) and verified line-for-line against it (every line within 2.4pt vertically, identical line breaks). Keep it that way:

- **One page, US Letter, 38pt (0.53in) side margins.** No `\vspace`/geometry squeezing to fit - cut content instead (relevance-weighted cutting from `05-cv-templates.md`).
- **Typography:** body 9pt on an 11pt pitch; name 20pt bold uppercase; headline 9.5pt bold; contact line 7.5pt; section headings 10pt bold uppercase. No hyphenation anywhere, no ligatures.
- **Colours:** navy `#0D1F3C` (name, section headings, job/employer lines, skill and education labels, project names); blue `#1C4E80` (headline, sub-role titles, links); grey `#555555` (contact line, dates, project tech stacks); body text black.
- **Section order (fixed):** Professional Summary -> Professional Experience -> Technical Skills -> Key Projects -> Education and Certifications. No Core Competencies, Languages or References sections - the master has none.
- **Header:** `\cvname`, then `\cvheadline` with 2-3 target titles joined by `\sep{}` (tailor these to the posting), then `\cvcontact` with location, phone, email, LinkedIn, portfolio and GitHub links, availability. Email and phone must stay as plain printed text (ATS).
- **Summary:** one justified paragraph, 4-5 lines.
- **Experience:** single-role employer -> `\cvjob{Title\sep{}Company, City}{dates}`. Multi-role employer -> `\cvemployer{Company, City}{overall dates}` then one `\cvsubrole{Title}{dates}` per role, `\cvgap` between roles and between employers. Bullets are ragged-right `itemize` (bullet at 18pt, text at 36pt).
- **Technical Skills:** one `\cvskill{Category}{item\dotsep{}item...}` line per category (4 categories in the master).
- **Key Projects:** `\cvproject{Name}{tech\dotsep{}tech}` (grey italic stack after a bar), 1-2 bullets each, `\cvprojgap` between projects.
- **Education and Certifications:** `\cvedu{Degree}{Institution[, City]}{[distinction\sep{}]year}` lines, then `\cvskill{Certifications}{...}` and a plain "In progress: ..." line.
- **Dates:** `Mmm YYYY - Mmm YYYY` / `Mmm YYYY - Present` with a single ASCII hyphen. The master shows an en-dash; the hyphen is a deliberate deviation so ATS imports (e.g. Workday) keep the date ranges and `verify_pdf.py --ascii-dates` passes.

## Known pitfalls

- **Separator macros swallow following letters.** Always write `\sep{}` and `\dotsep{}` (with braces) in body text. `\sepData` is parsed as an undefined control sequence and the separator plus the word vanish.
- **Escape LaTeX specials** in content: `\&` (Holland \& Barrett), `\%` (unescaped `%` silently deletes the rest of the line), `\#`, `\_`. The euro sign can be typed directly (`€`).
- **Calibri is licensed - never copy its .ttf files into this repo.** The template finds it in place. If Word is uninstalled the CV falls back to Carlito automatically.
- **Bullets extract as separate lines** in `pdftotext -bbox` (the glyph sits 18pt left of the text). Harmless for ATS - the text layer order is still correct.
- **Page fill:** the master fills the page to about 92%. When tailoring, keep a similar fill: if content overflows, cut the lowest-relevance bullet or project rather than shrinking spacing; if it ends early, restore the most relevant cut item.
