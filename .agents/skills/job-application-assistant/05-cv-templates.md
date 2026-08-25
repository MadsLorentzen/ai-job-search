---
framework_version: 1.4.2
---

# CV Templates and Tailoring Guide

## Template: LaTeX moderncv (Banking Style)

All CVs use the moderncv LaTeX package with the "banking" style and "blue" color scheme.

**Output file:** `cv/main_<company>.tex`
**Compile with:** **lualatex** on MiKTeX/TeX Live. pdflatex often fails on modern MiKTeX installs with `fontawesome5` font-expansion errors; lualatex handles the same sources cleanly.
**Master reference:** `cv/main_example.tex`

### Compile command

```bash
cd cv && lualatex -interaction=nonstopmode main_<company>.tex
```

Expected output: `Output written on main_<company>.pdf (2 pages, ...)` (or 1 page for single-column/1-page formats).

## Document Structure

```latex
\documentclass[11pt,a4paper,sans]{moderncv}
\moderncvstyle{banking}
\moderncvcolor{blue}

% Force the name and section headings to render in moderncv blue (color1).
\renewcommand*{\namefont}{\fontsize{34}{36}\bfseries\upshape}
\colorlet{firstnamecolor}{color1}
\colorlet{lastnamecolor}{color1}
\colorlet{namecolor}{color1}
\renewcommand*{\sectionstyle}[1]{{\sectionfont\color{color1}#1}}

\usepackage[utf8]{inputenc}
\AtEndPreamble{\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    filecolor=magenta,
    urlcolor=blue,
    pdftitle={Nehul Bhatnagar - CV},
    pdfpagemode=UseNone,
}}
\usepackage[scale=0.77]{geometry}
\usepackage{import}
\usepackage{needspace}

% Personal data
\name{Nehul}{Bhatnagar}
\address{Bengaluru, India}{}{}
\phone[mobile]{+91-8949446740}
\email{nbhatnagar3010@gmail.com}
\extrainfo{\href{https://www.linkedin.com/in/nehulbhatnagar}{LinkedIn} | \href{https://github.com/zerodoxxx}{GitHub}}

\begin{document}
\makecvtitle

% 1. Profile statement (tailored per role)
% 2. Technical Skills section
% 3. Professional Experience section
% 4. Selected Publications
% 5. Education section

\end{document}
```

### Critical Rules for CV Tailoring

1. **Mandatory Hyperlinks:** Always include clickable hyperlinks using `\href{...}{\underline{...}}` for research papers (e.g. arXiv URL `https://arxiv.org/abs/2602.07248`), email (`mailto:...`), LinkedIn, and project repositories.
2. **Page Budget & Orphan Prevention:**
   - CV should fit cleanly on **2 pages** (or 1 page for single-column compact format).
   - Use `\needspace{5\baselineskip}` before major entries to prevent orphaned titles.
   - Use `\enlargethispage{2-3\baselineskip}` if trailing sections need slight adjustment.
3. **No Em-Dashes:** Never use `--` or `—` in text. Use standard commas, colons, or parentheses.
4. **Factual Grounding:** All metrics, titles, and technologies must be grounded in `AGENTS.md` and `01-candidate-profile.md`.
