# Template: typst-modern

- **Type:** Cover letter
- **Source extension:** .typ
- **Engine/toolchain:** typst
- **Page limit:** 1 page(s)
- **Fonts:** Libertinus Serif (bundled with Typst — no extra font files)
- **Class/packages:** standard

## Compile command

    cd cover_letters && typst compile <file>.typ <file>.pdf

## Style rules

- One page including the signature block
- Word budget: 250-300 words of body text
- 3-5 bullets, each starting with a bold label
- Email and phone printed as literal text in the header
- No em-dashes; no cliches; every company claim verified

## Known pitfalls

- `#datetime.today()` stamps today's date; do not hard-code a stale date.
- Keep the letter single-column. Overflow: cut restated sentences first, then a non-keyword bullet.
- Typst `#` is markup. Write `\#` for a literal hash in body text.
- Fill `[PLACEHOLDER]` tokens from the profile; never invent facts.
