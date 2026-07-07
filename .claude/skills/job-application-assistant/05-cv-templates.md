# CV Templates and Tailoring Guide

<!-- SETUP: Profile statements and section ordering are personalized by running /setup -->

## Two templates (pick one per application)

There are two CV templates. Both compile with **lualatex** and must produce **exactly 2 pages**. The tailoring guidance, page-budget rules, and compile-and-inspect loop in the rest of this doc apply to **both**.

- **Template A — `ajcv.cls` (single-column, DEFAULT).** Reproduces AJ's own "2026 Growth Lead" resume: Josefin Sans display + Carlito body (Calibri metric-compatible), monochrome. This is the preferred look — it matches the resume AJ actually uses. Master reference: `cv/main_example_ajstyle.tex`. See "Template A" below.
- **Template B — moderncv banking.** The original blue-accent moderncv style. Kept as an alternative. Master reference: `cv/main_example.tex`. See "Template B" below.

Default to Template A unless the user asks for the moderncv look. The live Vercel application (`cv/main_vercel.tex`) uses Template A as the reference implementation.

---

## Template A: Single-column (`ajcv.cls`) — DEFAULT

A custom class at `cv/ajcv.cls`. Reproduces AJ's real resume format.

**Output file:** `cv/main_<company>.tex` with `\documentclass{ajcv}`
**Compile with:** **lualatex** (fontspec + Josefin Sans/Carlito need it; pdflatex will not work). Run from the `cv/` directory so the class resolves.
**Fonts (resolve by name from TeX Live, no install):** body = **Carlito** (metric-compatible Calibri substitute; true Calibri is proprietary and non-portable), display = **Josefin Sans**. Monochrome: ink `#1A1A1A`, mid-grey `#4D4D4D`, grey `#808080`.
**Master reference:** `cv/main_example_ajstyle.tex` (full untailored CV — copy and tailor Summary + Core Competencies + bullet emphasis).

### Compile command

```bash
cd cv && lualatex -interaction=nonstopmode main_<company>.tex
```

Expected: `Output written on main_<company>.pdf (2 pages, ...)`. Harmless `Font shape ... not available` warnings come only from math glyphs (`$\rightarrow$`); prefer `\textasciitilde{}` and `\textperiodcentered{}` over `$\sim$`/`$\cdot$` to keep text on-font.

### Macros (provided by ajcv.cls)

```latex
\documentclass{ajcv}
\hypersetup{pdftitle={AJ Magnuson - CV - <Company>}}
\begin{document}

\cvheader{A. J. Magnuson}{%                     % name (left) + contact (right), with rule
  \href{mailto:ae@alumni.stanford.edu}{ae@alumni.stanford.edu} \ \textbar\ 650.814.7296 \\[1pt]
  \href{https://linkedin.com/in/ajmagnuson}{linkedin.com/in/ajmagnuson}}

\cvsection{Summary}                            % small tracked grey caps label
\cvsummary{...tailored 3-4 line summary...}

\cvsection{Core Competencies}
\begin{cvbullets}                              % round bullets, metrics in \textbf
  \item \textbf{Label:} ...
\end{cvbullets}

\cvsection{Experience}
\cventry{Company}{Location}{Dates}             % bold-caps company, grey location, right-aligned dates
\cvdescriptor{One-line company descriptor.}    % optional grey line under company
\cvrole{Role Title}                            % rounded display accent, indented
\begin{cvbullets}
  \item ...
\end{cvbullets}

\cvskillline{A \textperiodcentered{} B \textperiodcentered{} C}  % middot-separated inline list

\end{document}
```

- **LinkedIn in the header** sits on a second contact line (the full URL will not fit on one line beside the name); the contact block is vertically centered against the name.
- **Orphan control** is built into `\cventry` (`\needspace{5\baselineskip}`). If a company title still orphans from its bullets, nudge with `\enlargethispage{2\baselineskip}` on the prior page.
- The optional footer sections (`Highlights`, `Growth Systems & Infrastructure`) from `main_example_ajstyle.tex` are good page-2 fillers when a tailored CV runs thin.

---

## Template B: LaTeX moderncv (Banking Style)

This is the moderncv option. Use it when the user specifically wants the blue-accent moderncv look; otherwise prefer Template A.

CVs in this style use the moderncv LaTeX package with the "banking" style and "blue" color scheme.

**Output file:** `cv/main_<company>.tex`
**Compile with:** **lualatex** on MiKTeX/TeX Live. pdflatex often fails on modern MiKTeX installs with `fontawesome5` font-expansion errors; lualatex handles the same sources cleanly.
**Master reference:** `cv/main_example.tex` (comprehensive CV with all competencies, experience, and achievements - use as source when building targeted CVs)

### Compile command

```bash
cd cv && lualatex -interaction=nonstopmode main_<company>.tex
```

Expected output: `Output written on main_<company>.pdf (2 pages, ...)`. Any page count other than 2 is a failure that must be fixed before presenting to the user.

## Document Structure

```latex
\documentclass[11pt,a4paper,sans]{moderncv}
\moderncvstyle{banking}
\moderncvcolor{blue}

% Force both first and last name AND section headings to render in moderncv
% blue (color1). Default banking on lualatex+MiKTeX leaves these black, which
% looks inconsistent with the rest of the blue accent scheme.
\renewcommand*{\firstnamestyle}[1]{{\fontsize{34}{36}\bfseries\upshape\color{color1}#1}}
\renewcommand*{\lastnamestyle}[1]{{\fontsize{34}{36}\bfseries\upshape\color{color1}#1}}
\renewcommand*{\sectionstyle}[1]{{\sectionfont\color{color1}#1}}

\usepackage[utf8]{inputenc}
\usepackage{hyperref}
\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    filecolor=magenta,
    urlcolor=blue,
    pdftitle={[YOUR_NAME] - CV},
    pdfpagemode=FullScreen,
}
\usepackage[scale=0.77]{geometry}
\usepackage{import}

% Personal data
\name{[FIRST_NAME]}{[LAST_NAME]}
\address{[YOUR_ADDRESS]}{}{}
\phone[mobile]{[YOUR_PHONE]}
\email{[YOUR_EMAIL]}
\extrainfo{\href{[YOUR_LINKEDIN_URL]}{LinkedIn}, \href{[YOUR_GITHUB_URL]}{GitHub}}

\begin{document}
\makecvtitle

% 1. Profile statement (1-3 sentences, tailored per role)
% 2. Skills section
% 3. Education section
% 4. Professional Experience section
% 5. Selected Publications (if applicable)
% 6. Honors and Awards (if applicable)
% 7. References

\end{document}
```

### Color overrides

The three `\renewcommand*` lines in the preamble are required on lualatex+MiKTeX. Without them the firstname, lastname, and section headings render in black even though `\moderncvcolor{blue}` is set, which looks inconsistent with the rest of the blue accent scheme (links, bullet markers, contact icons). The override forces all three to use `color1` (moderncv's accent colour, which becomes blue under `\moderncvcolor{blue}`). Both names render bold; if you prefer the firstname in regular weight, change the firstnamestyle override from `\bfseries` to `\mdseries`. Don't drop the override - on most modern installs the defaults render visibly wrong.

### Spacing inside itemize lists (important)

**Do not place `\vspace{...}` between `\item` entries in an `itemize` list.** Even though the source looks symmetric, this pattern occasionally produces a noticeably oversized gap before a single item: the inter-item `\vspace` creates a paragraph break that interacts unpredictably with the list's internal `\itemsep`, so LaTeX renders one of the gaps wider than the rest. Remove the inter-item `\vspace` and let `itemize` use its native uniform spacing.

```latex
% WRONG - intermittently produces an oversized gap before one bullet
\begin{itemize}
\item \textbf{Foo}: ...
\vspace{1pt}
\item \textbf{Bar}: ...
\vspace{1pt}
\item \textbf{Baz}: ...
\end{itemize}

% RIGHT - uniform spacing using the list's native itemsep
\begin{itemize}
\item \textbf{Foo}: ...
\item \textbf{Bar}: ...
\item \textbf{Baz}: ...
\end{itemize}
```

Two related patterns are fine and should be kept:
- `\vspace{1pt}` immediately after `\section{...}` (between section heading and first item) - this is between the heading and the list, not between list items.
- `\vspace{3pt}` between top-level `\cventry` blocks in Professional Experience or Education - this gives breathing room between roles and renders consistently.

## Section-by-Section Tailoring

### Profile Statement / Elevator Pitch (Best Practice)
This is the most important section to customize. It appears right after `\makecvtitle`.

Write 5-7 lines that function as an "elevator pitch": a concise, compelling introduction explaining why you're qualified for *this specific role*. Focus on what the employer gains from hiring you.

**Create 2-3 profile statement templates for your main role types:**

**For Growth Executive / VP of Growth / Head of Growth roles:**
> Product-led Growth executive and former engineer with a track record of driving 3-9x revenue growth across B2C, B2B, and B2B2C platforms. Builder of scalable growth engines spanning acquisition, activation, retention, monetization, and pricing. Experienced leading experimentation orgs, establishing KPI systems, architecting growth loops, and turning data infrastructure into predictable revenue acceleration.

**For Sr. Product Manager (Growth) / Growth Lead roles:**
> Senior product leader with engineering roots and a consistent track record of scaling self-serve PLG funnels. Specialized in experimentation velocity, lifecycle architecture, and pricing and packaging strategy that compound into predictable revenue growth. Comfortable building the experimentation and lifecycle stack alongside engineering rather than handing off specs.

**For Growth IC at a frontier AI lab (OpenAI, Anthropic, etc.):**
> Growth operator with a builder background and an AI-native default. Three-time founder, former first engineering hire (RockYou, 100M+ MAU), and operator who launched 0-to-1 AI Email Marketing at Beacons, the fastest ESP to reach 50M cumulative email volume. Looking to focus deep on a single surface inside a mission I believe in.

**For Lifecycle / Email Marketing leadership roles:**
> Lifecycle and messaging specialist with end-to-end ownership of the stack: built DailyPay's lifecycle and analytics stack (Iterable + Segment + Amplitude) that supported 5.7x revenue expansion, and shipped Beacons' 0-to-1 AI Email Marketing, the fastest ESP to 50M cumulative email volume. Treats lifecycle as a compounding growth system, not a campaign function.

### Core Competencies / Skills Section (Best Practice)
Reorder and emphasize based on the role. Use bold category labels.

List **5-7 key competencies** in bullet format, tailored to the specific job. For each competency, briefly explain how it adds value to the position.

### Education
- Always include your highest degrees
- For senior roles, keep education brief (dates and titles only)
- Include thesis topics when relevant to the target role

### Professional Experience
- Rewrite bullet points to emphasize aspects most relevant to the target role
- Use 4-6 bullets for most recent role, 3-4 for previous, 2-3 for older
- **Emphasize measurable results** where possible: "Reduced processing time by X%", "Model adopted by the team"

### Handling Employment Gaps (Best Practice)
If there is a gap in your employment history:
- The gap should be explained matter-of-factly if needed
- Describe how professional development continued during the gap
- Frame as deliberate skill-building and career repositioning

### Publications
- Include Google Scholar link if applicable
- Select 3-4 most relevant publications (not always all of them)
- For non-academic roles, keep brief

### Honors and Awards
- Keep format brief, one line each

### References
- List 2-4 references with name, title, company, and contact
- End with: "More references are available upon request."
- **Do not attach reference letters** - employers typically contact references directly

## Compile-and-Inspect Loop (MANDATORY)

After writing the CV and before presenting to the user, always compile and visually inspect the PDF. Iterate until the layout is clean. Workflow:

1. Run `lualatex -interaction=nonstopmode main_<company>.tex`
2. Check the output page count: must be exactly 2
3. Read the PDF via the Read tool and visually inspect both pages
4. Check for **orphaned entries**: a `\cventry` title line must never sit alone at the bottom of page 1 with its bullets on page 2

### Fixing common page-break problems

**Problem: entry title on page 1, bullets orphaned to page 2**
Add `\needspace{5\baselineskip}` immediately before the problematic `\cventry`:
```latex
\needspace{5\baselineskip}
\item{\cventry{YEAR--YEAR}{Role Title}{Organization}{Location}{}{...}}
```
Include `\usepackage{needspace}` in the preamble.

**Problem: one trailing section spills to page 3 (e.g., References alone on page 3)**
Add `\enlargethispage{2-3\baselineskip}` before a late section (e.g., before `\section{Honors and Awards}`) to stretch page 2 by a few lines. This is the standard LaTeX rescue for near-miss overflows.

**Problem: 3 pages with significant content on page 3**
Cut content — do not compress geometry or `\vspace`. See "Relevance-weighted cutting" below for the rule.

**Problem: content finishes early on page 2 (feels thin)**
Restore the highest-relevance item that was previously cut — a CV that ends mid-page 2 looks incomplete.

## Page Budget - Hard 2-Page Limit

The CV **must** fit on exactly 2 pages when compiled. Use these content limits as a guide:

| Section | Max budget |
|---------|-----------|
| Profile statement | 3-4 lines |
| Skills | 5 items, each 1-2 lines |
| Most recent role | 4-5 bullets |
| Previous role | 2-3 bullets |
| Older roles | 2 bullets (1 line each) |
| Education | 2-3 entries |
| Publications | 2-3 entries |
| Awards | 3 entries, single line each |
| References | "Available upon request." (single line) |

**If in doubt, cut rather than squeeze.** Reducing `\vspace` or geometry scale to force-fit content makes the CV look cramped.

## Relevance-weighted cutting (the right way to shrink a CV)

**Cut by signal, not by section.** Static priority lists ("remove oldest education first, then shorten the earliest role...") are wrong when a relevant "lower-priority" item is competing with an irrelevant "higher-priority" item. An older-role bullet that speaks directly to the posting is worth more than a recent-role bullet that does not.

For every candidate line, score three things:

1. **Relevance to THIS posting** — does the line hit a named tool, keyword, or stated responsibility in the job ad?
2. **Uniqueness** — is it the only place this claim appears, or is it duplicated elsewhere in the CV?
3. **Narrative load** — does the cover letter depend on it? If cutting the line would force you to rewrite a cover-letter paragraph, it is load-bearing.

Cut the lowest-total-score line first, regardless of which section it sits in.

### Practical order of cuts (easiest → last resort)

1. **Redundancy.** If an achievement appears in both Core Competencies AND a role bullet, the Core Competencies version is usually the cleaner cut (the experience bullet is more concrete evidence).
2. **Profile-statement fluff.** A sentence that just restates what Publications or Skills will show. ("Peer-reviewed publications on X..." is already a Publications entry — profile can claim it once and stop.)
3. **Low-relevance experience bullets.** A bullet about work that does not touch posting keywords, wherever it sits. This cuts across sections before touching the structural list.
4. **Low-relevance supporting content.** An older-role bullet that does not speak to the target role. A certification that does not touch the posting's stack. A language entry that can be condensed to one line.
5. **Low-relevance publications.** Keep 1-2 publications that best match the posting. Cut the rest before touching experience bullets.
6. **Last-resort structural cuts.** Oldest education entry, tightening an older role to 2 bullets, collapsing Certifications into a single line. These only happen if the relevance-weighted cuts above have already been exhausted.

### Pitfalls to avoid

- Do not mechanically cut from the bottom of a static section list without checking relevance. "Cut the oldest role first" is wrong if that role is literally about the skill the posting asks for.
- Do not cut the one concrete example the cover letter leans on. Relevance is measured against the cover letter you wrote, not just the job posting — interviewers will have read both.
- Do not cut to fit if the fit is borderline (2.02 pages). Prefer `\enlargethispage{2-3\baselineskip}` on a late section for near-misses; reserve content cuts for genuine overflow (content on page 3 that is more than a single trailing section).

## Recommended Section Order

The section order varies by role type:

**For technical / data science / ML roles:**
1. Profile statement / elevator pitch
2. Core competencies / Skills
3. Professional Experience (reverse chronological)
4. Education (reverse chronological)
5. Languages
6. Publications & Awards
7. References

**For domain-specific / specialist roles:**
1. Profile statement / elevator pitch
2. Core competencies / Skills
3. Education (reverse chronological) - credentials are a key qualifier
4. Professional Experience (reverse chronological)
5. Publications & Awards
6. References
