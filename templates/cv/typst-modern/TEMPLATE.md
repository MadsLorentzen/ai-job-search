# Template: typst-modern

- **Type:** CV
- **Source extension:** .typ
- **Engine/toolchain:** typst
- **Page limit:** 2 page(s)
- **Fonts:** Libertinus Serif (bundled with Typst — no extra font files)
- **Class/packages:** standard

## Compile command

    cd cv && typst compile <file>.typ <file>.pdf

## Style rules

- Single column, A4, blue accent headings with a bottom rule
- Contact line is printed as literal text (email and phone must stay visible, not icon-only)
- Dates in role/education arguments use a **single ASCII hyphen** (`2016-2024`), never `--` or an en-dash
- Keep section order unless the posting's role type calls for education-first
- Bold skill-category labels; 5-7 competency bullets
- Hard limit: exactly 2 pages

## Known pitfalls

- Typst comments are `//` and `/* */`. A `#` starts markup; in body text write `\#` only when you need a literal hash (C\#, ranked \#1).
- `https://...` URLs in `#link("...")` need the quotes; do not wrap them in angle brackets.
- Do not switch to a two-column layout — ATS reading order will scramble.
- Fill `[PLACEHOLDER]` tokens from `01-candidate-profile.md`; never invent facts.
