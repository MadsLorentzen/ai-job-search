# Document Template Policy

## CV

- Source: `cv/main_<company>_<role>.tex` or an approved custom template.
- Stock format: moderncv banking style.
- Compile with `lualatex`.
- Target exactly two pages.
- Preserve literal section headings in the CV language.
- Tailor profile statement, competencies, and bullet emphasis to the posting.
- Use `\needspace{5\baselineskip}` only before entries that compile with orphaned titles.
- Use relevance-weighted cutting when content exceeds the page limit.
- Include literal email and phone text for ATS extraction.
- Never use a tailored CV as a source of facts.

## Cover letter

- Source: `cover_letters/cover_<company>_<role>.tex`.
- Stock class: `cover.cls` with bundled Lato/Raleway fonts.
- Compile with `xelatex`.
- Target exactly one page including the signature.
- Keep `itemize` outside `\lettercontent{}` and wrap it in the matching Raleway font block.
- Address a named person when known; otherwise use an appropriate hiring-team salutation.
- Match the posting language.

## Verification

Compile before delivery. Check exact page counts with `pdfinfo`, extract the text layer with `pdftotext -layout`, check contact details, dates, section order, garbled glyphs, and truthful keyword coverage. Keep only source and PDF artifacts after cleanup.
