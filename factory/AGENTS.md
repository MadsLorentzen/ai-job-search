# Factory — LaTeX sources

The compile-able factory for applications: `main_example.tex` (master CV),
`cover.cls` + `cover_example.tex` (cover letter), `OpenFonts/` (typefaces),
plus the reference docs `05-cv-templates.md` / `06-cover-letter-templates.md`
that describe how to tailor them.

- Tailored copies are compiled per application into
  `applications/<company>_<role>/` — never edit the master for one application.
- After every compile, verify with `cv_verify` / the verify-pdf CLI
  (`methods/03-apply.md` gates on it).
