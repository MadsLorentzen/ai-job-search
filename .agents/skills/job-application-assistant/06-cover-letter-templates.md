---
framework_version: 1.0.2
---

# Cover Letter Templates and Tailoring Guide

## Template: Custom cover.cls (XeLaTeX)

Cover letters use a custom LaTeX document class (`cover.cls`) with Lato/Raleway fonts.

**Output file:** `cover_letters/cover_<company>_<role>.tex`
**Compile with:** XeLaTeX (cover.cls requires fontspec)
**Font directory:** `cover_letters/OpenFonts/fonts/`

### Compile command

```bash
cd cover_letters && xelatex -interaction=nonstopmode cover_<company>_<role>.tex
```

Expected output: `Output written on cover_<company>_<role>.pdf (1 page, ...)`. Any page count other than 1 is a failure that must be fixed before presenting to the user.

## Compile-and-Inspect Loop (MANDATORY)

After writing the cover letter and before presenting to the user, always compile and visually inspect the PDF:

1. Run `xelatex -interaction=nonstopmode cover_<company>_<role>.tex`
2. Confirm page count is exactly 1 and compile succeeded
3. Visually check: signature fits at the bottom, no text cut off, bullet font matches body

### Known template pitfall: itemize inside `\lettercontent{}`

The `\lettercontent{}` macro appends `\\` to its argument. This breaks when the argument ends in `\end{itemize}`.

**Correct — close `\lettercontent{}` before the list and wrap the list in the matching Raleway-Medium font:**
```latex
\lettercontent{Here is how my experience maps:}

{\raggedright\fontspec[Path = OpenFonts/fonts/raleway/]{Raleway-Medium}\fontsize{11pt}{13pt}\selectfont
\begin{itemize}
    \item {[Concrete achievement/skill 1]}
    \item {[Concrete achievement/skill 2]}
    \item {[Concrete achievement/skill 3]}
\end{itemize}\par}
\vspace{6pt}

\lettercontent{[next paragraph]}
```

## Document Structure

```latex
\documentclass[]{cover}
\usepackage{fancyhdr}

\pagestyle{fancy}
\fancyhf{}

\rfoot{Page \thepage \hspace{0pt}}
\thispagestyle{empty}
\renewcommand{\headrulewidth}{0pt}
\begin{document}

\namesection{}{Nehul Bhatnagar}{  \href{mailto:nbhatnagar3010@gmail.com}{nbhatnagar3010@gmail.com} | +91-8949446740 |  \urlstyle{same}\href{https://www.linkedin.com/in/nehulbhatnagar}{LinkedIn}
}

\currentdate{\today}
\lettercontent{Dear [Name / Hiring Team],}

\lettercontent{[Opening paragraph - role, connection to background, 2-3 sentences]}

\lettercontent{[Body paragraph - most relevant experience, introducing the bullet list]}

{\raggedright\fontspec[Path = OpenFonts/fonts/raleway/]{Raleway-Medium}\fontsize{11pt}{13pt}\selectfont
\begin{itemize}
    \item {[Concrete achievement/skill 1]}
    \item {[Concrete achievement/skill 2]}
    \item {[Concrete achievement/skill 3]}
\end{itemize}\par}

\lettercontent{[Connection to company - why this role, why this company specifically]}

\lettercontent{[Personal fit paragraph - behavioral strengths, team contribution, 2-3 sentences]}

\lettercontent{I look forward to hearing from you.}

\begin{flushright}
\closing{Kind regards,}

\signature{Nehul Bhatnagar}
\end{flushright}
\end{document}
```
