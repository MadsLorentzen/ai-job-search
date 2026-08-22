---
framework_version: 1.5.2
---

# CV Templates and Tailoring Guide

<!-- SETUP: Profile statements and section ordering are personalized by running /setup -->

## Template routing by market (standing rule)

Two templates are in active use, selected by the target role's market — never by user preference on a given day, and never mixed:

| Market | Template | Section below |
|---|---|---|
| UK | moderncv banking style | "Template: LaTeX moderncv (Banking Style)" |
| Ireland | moderncv banking style (added 2026-08-20) | "Template: LaTeX moderncv (Banking Style)" |
| Germany | Lebenslauf (moderncv classic + photo) | "Template: Lebenslauf (German-Market CV Format)" |

Determine market from the posting's location, not from the target company's HQ — a UK-based role at a German company still uses the banking template. Content stays in **English** either way (see CLAUDE.md's `CV language` line) — the Lebenslauf format changes *presentation* (photo, personal-data block, German CV conventions), never the language.

**Ireland uses the UK banking template, not the German Lebenslauf.** Irish CV convention follows UK/US norms — no photo, no date of birth, no marital status — and Ireland's Employment Equality Acts prohibit discrimination on those grounds the same way UK law does, so including that personal-data block would look out of place (and mildly risky) on an Irish application, unlike Germany where it's standard practice.

## Template: LaTeX moderncv (Banking Style)

All CVs use the moderncv LaTeX package with the "banking" style and "blue" color scheme.

**Output file:** `cv/main_<company>_<role>.tex`
**Compile with:** **lualatex** on MiKTeX/TeX Live. pdflatex often fails on modern MiKTeX installs with `fontawesome5` font-expansion errors; lualatex handles the same sources cleanly.
**Master reference:** `cv/main_example.tex` (comprehensive CV with all competencies, experience, and achievements - use as source when building targeted CVs)

### Compile command

```bash
cd cv && lualatex -interaction=nonstopmode main_<company>_<role>.tex
```

Expected output: `Output written on main_<company>_<role>.pdf (2 pages, ...)`. Any page count other than 2 is a failure that must be fixed before presenting to the user.

## Document Structure

```latex
\documentclass[11pt,a4paper,sans]{moderncv}
\moderncvstyle{banking}
\moderncvcolor{blue}

% Force the name and section headings to render in moderncv blue (color1).
% Default banking leaves them black: moderncvstylebanking.sty's \colorlet
% copies (not aliases) the pre-scheme accent colour, so the name colours are
% frozen before \moderncvcolor runs. Re-let them after. \namefont is the hook
% every name-style macro routes through, so this also works on moderncv 2.3.1
% (Debian/Ubuntu apt), which has no \firstnamestyle/\lastnamestyle at all.
\renewcommand*{\namefont}{\fontsize{34}{36}\bfseries\upshape}
\colorlet{firstnamecolor}{color1}
\colorlet{lastnamecolor}{color1}
\colorlet{namecolor}{color1}
\renewcommand*{\sectionstyle}[1]{{\sectionfont\color{color1}#1}}

\usepackage[utf8]{inputenc}
% moderncv loads hyperref itself in an \AtEndPreamble hook, so \hypersetup
% must go in an \AtEndPreamble of our own: on moderncv < 2.4 a top-level
% \usepackage{hyperref} clashes with the class's own
% \RequirePackage[unicode]{hyperref}. From 2.4.0 the class passes its options
% through \PassOptionsToPackage instead, which is what removes that clash.
\AtEndPreamble{\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    filecolor=magenta,
    urlcolor=blue,
    pdftitle={[YOUR_NAME] - CV},
    % Keep pdfpagemode=UseNone: this block runs after moderncv's own
    % \AtEndPreamble (moderncv.cls sets pdfpagemode there), so a FullScreen
    % value here would win and open every CV in fullscreen presentation mode.
    pdfpagemode=UseNone,
}}
\usepackage[scale=0.77]{geometry}
\usepackage{import}

% Personal data
\name{[FIRST_NAME]}{[LAST_NAME]}
% If you have no address to list, DELETE this whole line. \address{}{}{} fails
% with "There's no line here to end" on every moderncv version.
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

The `\renewcommand*` on `\namefont` and the three `\colorlet` lines in the preamble are required on lualatex+MiKTeX. Without them the name and section headings render in black even though `\moderncvcolor{blue}` is set, which looks inconsistent with the rest of the blue accent scheme (links, bullet markers, contact icons). The cause: `moderncvstylebanking.sty` defines the name colours with `\colorlet`, which *copies* the accent colour as it is before the scheme is applied, so the name colours are frozen to the pre-scheme value; re-assigning them with `\colorlet` after `\moderncvcolor{blue}` (as the preamble does) re-pins them to `color1`. `\namefont` is the shared hook every name-style macro routes through, so the block is version-agnostic - including moderncv 2.3.1 from Debian/Ubuntu apt, which has no `\firstnamestyle`/`\lastnamestyle` at all. Both names render bold; if you prefer regular weight, change `\bfseries` to `\mdseries` in the `\namefont` line (the weight now lives there, so it applies to the whole name). Don't drop the overrides - on most modern installs the defaults render visibly wrong.

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

### Section headings must match the CV's language (important)

Section headings such as `\section{Core Competencies}`, `Professional Experience`, `Education`, `Languages`, `Publications`, `Honors and Awards`, `References` (and any others your template defines), plus the `Available upon request.` line under References, are all **literal English text baked into the template** - they do not translate themselves. Whenever the CV language (see `CV language` in the candidate profile) is not English, translate every one of these too, whatever they are, not just the body prose - a CV with a fully localized profile statement and bullets sitting under untouched English section headers reads as sloppy and inconsistent, and it's an easy thing to forget precisely because the prose translation is the obvious, visible part of the job. Worked example for Spanish: `Competencias Clave`, `Experiencia Profesional`, `Educaci\'on`, `Idiomas`, `Publicaciones`, `Distinciones y Premios`, `Referencias`, `Disponibles a solicitud.` The same rule applies for any other target language - check this explicitly during the verification pass.

## Template: Lebenslauf (German-Market CV Format)

For every German-market role (see "Template routing by market" above). Built on moderncv's **classic** style rather than banking style, because classic's native `\cventry` layout (date in a narrow left column, role/employer/description in a wide right column) already matches German Lebenslauf convention, and it supports a header photo natively via `\photo`.

**Output file:** `cv/main_<company>_<role>.tex` (same naming convention as the banking template — market determines *content*, not the filename pattern)
**Compile with:** lualatex, same as the banking template
**Master reference:** `cv/main_example_lebenslauf.tex`
**Photo asset:** `cv/assets/photo.png` (shared across every German-market CV — do not duplicate per role)

### Compile command

```bash
cd cv && lualatex -interaction=nonstopmode main_<company>_<role>.tex
```

Expected output: 2 pages, same as the banking template.

### What's different from the banking template

- **`\moderncvstyle{classic}`** instead of `banking`.
- **`\photo[64pt][0.4pt]{assets/photo}`** in the preamble — the only template that includes a photo. Never add a photo to a UK-market (banking-style) CV.
- **`\title{...}`** under the name — keep this **short** (under ~30 characters). A longer tagline wraps to two lines and collides with the address block that sits to its right in the header; this was a real layout bug caught during template construction, not a hypothetical one. `Product Owner -- Payments \& Wallets` is the tested-safe length.
- **A "Personal Details" section**, placed immediately after the header, before "Profile":
  ```latex
  \section{Personal Details}
  \begin{tabularx}{\linewidth}{@{}p{0.24\linewidth}p{0.24\linewidth}p{0.18\linewidth}X@{}}
  \textbf{Date of Birth:} & 09 February 1988 & \textbf{Nationality:} & Indian \\[4pt]
  \textbf{Marital Status:} & Married & \textbf{Relocation:} & Chancenkarte (Opportunity Card) -- actively preparing application documents \\
  \end{tabularx}
  ```
  Values come from `01-candidate-profile.md`'s "Personal Details (German-market Lebenslauf CVs only)" section — never re-derive or guess them per role. **Never write "no employer sponsorship needed" or similar** — see CLAUDE.md's Germany-roles note for why that overclaims: the Chancenkarte only means entry and job search don't require a sponsor *first* (unlike the UK's licensed-sponsor system), not that the employer has zero role after hire — converting to a job-based residence permit still involves the employer providing the job contract. Keep the label columns at their current widths (`0.24`/`0.24`/`0.18`) — narrower and `Marital Status:` or a `Relocation:`-style label hyphenates mid-word, which is what the first draft of this template did before the widths were fixed.
- **Skills and Languages use `\cvitem{label}{value}`** (moderncv's built-in two-column item), not bullet lists — matches the tabular label/value convention the rest of the German CV uses. Category labels wrapping to two lines (e.g. "Agile & / Delivery") is normal `\cvitem` behavior at these widths and is not a bug worth fixing.
- **A closing signature line** at the very end of the document, using the real signature image:
  ```latex
  \vspace{20pt}
  \begin{tabularx}{\linewidth}{@{}X r@{}}
  Reading, DD.MM.YYYY & \raisebox{-0.5\height}{\includegraphics[height=1.2cm]{assets/signature}} \\
  \end{tabularx}
  ```
  Use the numeric `DD.MM.YYYY` format (German convention), not a spelled-out English date, and set it to the actual date the CV is generated. **Signature asset:** `cv/assets/signature.jpg` (source: `documents/cv/shamik - sign.jpg`) — a real signature, supplied by the candidate. Never fabricate a stylised/cursive text rendering as a stand-in for a signature; if the asset is ever missing, ask the candidate for one rather than approximating with an italic font.
- **No "References" section.** The candidate's own reference Lebenslauf (`documents/cv/Shamik_Mukherjee_Lebenslauf_EN.pdf`) omits it, matching common German CV practice; don't add one back in in for this template.

### Draft with placeholder images, swap in the real ones only on the final pass (trial, added 2026-08-21)

The photo (`\photo[64pt][0.4pt]{assets/photo}`) and the closing signature (`\includegraphics[height=1.2cm]{assets/signature}`) are the two things that make Lebenslauf compiles/inspections more expensive than the banking template: LaTeX reserves page-layout space based on the **declared width/height parameter**, not the source image's actual pixel content, so a tiny placeholder image at the same declared dimensions produces byte-identical page breaks to the real photo/signature — but is far cheaper to visually inspect via the Read tool during iteration.

**Shared placeholder assets** (create once, reuse across every Lebenslauf CV, same convention as the real assets): `cv/assets/photo_placeholder.png`, `cv/assets/signature_placeholder.png` — minimal 1x1-pixel PNGs, already created.

**Workflow:**
1. During drafting (Step 2), reviewer revision (Step 4), and the entire page-fitting compile/inspect loop (Step 5's first pass), reference `assets/photo_placeholder` and `assets/signature_placeholder` instead of the real assets, using the **exact same declared width/height parameters** the real ones use (`[64pt][0.4pt]` for the photo, `height=1.2cm` for the signature).
2. Only once page count, layout, and content have fully passed the Verification Checklist against the placeholder version, swap both `\photo{...}` and `\includegraphics{...}` calls back to the real `assets/photo` / `assets/signature` filenames.
3. Recompile twice (cross-references need a second pass to settle) and run **one final visual inspection with the real images** — confirm the actual photo/signature render correctly (not cropped, not corrupted, correct orientation). This final check is not skippable — the placeholder swap only defers the expensive image inspection, it doesn't remove the need for it once.

**Status: trial.** Being tried on the next 2-3 German-market roles (SIGNAL IDUNA, EDEKABANK, spotixx) to measure actual token savings against this session's established baselines before being treated as a firm rule. If the savings are tangible, this becomes standard practice for every Lebenslauf CV going forward; if not, revert to compiling with the real assets throughout.

### Fixed at the root: classic-style `\cventry` blocks used to be atomic (bug found 2026-08-21, cost 300k+ tokens to diagnose once; root-cause fix applied same day, verified against real content)

`\moderncvstyle{classic}`'s stock `\cventry` (title + bullets) does **not** split across a page break — if the whole block doesn't fit in the space remaining on the current page, LaTeX moves it wholesale to the next page rather than breaking mid-entry. On a Lebenslauf CV this commonly strands blank space at the bottom of page 1 (the first, usually longest, entry doesn't fit) and cascades into a 3rd page for Publications/Honours/the signature line, even though the *content* comfortably fits in 2 pages.

**Root cause, confirmed by reading moderncv's actual source** (`moderncvbodyi.sty`, the body file `classic` loads): `\cventry` wraps its bullet description in a `minipage`, and delegates its header row to `\cvitem`, which wraps everything in a plain `tabular`. Both are genuine LaTeX box types that categorically cannot split across a page break, regardless of content length — this isn't a stylistic choice, it's the same restriction that makes plain `tabular` (as opposed to `longtable`) unable to break across pages.

**Fix (now baked into `cv/main_example_lebenslauf.tex`'s preamble — copy it into every new Lebenslauf CV, don't re-derive it):** a custom `\renewcommand*{\cventry}` that keeps the short header line in the original `\cvitem`/`tabular` row (never itself an issue — one line), but renders the bullet description as a genuine breakable `list` environment (indented via `\leftmargin` to preserve the original column alignment) instead of a `minipage`. Verified empirically with a forced page-break test: a bullet list now splits mid-list across a page break, with the header staying attached to whichever bullets fit rather than the whole entry jumping as one atomic unit. Also verified against the full master reference's real content (photo, Personal Details, all 8 experience entries, Skills, Languages, Publications, Honours, signature) — no visual regressions anywhere.

**This eliminates the failure mode entirely — it does not just make it cheaper to work around.** `\enlargethispage` may still occasionally be useful for ordinary 2-page-budget trimming (the same way it's used in the banking template), but it is no longer the fix for this specific bug, since the bug's root cause no longer exists. Do not reach for `\enlargethispage`-tuning first on a Lebenslauf page-count problem — check whether the CV's preamble actually includes the custom `\cventry` redefinition before doing anything else.

Everything else — profile statement writing, experience bullet tailoring, relevance-weighted cutting, the 2-page budget, the ATS text-layer checks, the compile-and-inspect loop, reverse-chronological ordering — follows the exact same rules as the banking template below. Read those sections too; they are not repeated here.

## Section-by-Section Tailoring

### Profile Statement / Elevator Pitch (Best Practice)
This is the most important section to customize. It appears right after `\makecvtitle`.

Write 5-7 lines that function as an "elevator pitch": a concise, compelling introduction explaining why you're qualified for *this specific role*. Focus on what the employer gains from hiring you.

When the role sits outside your home domain, **lead with the domain-transfer argument** - the one or two sentences connecting your background to their problem (e.g. wave physics to radar signal processing) belong in the profile statement's opening, not buried in the cover letter. It is the strongest card a domain-changer holds; play it first.

**Create 2-3 profile statement templates for your main role types:**

<!-- SETUP: These are populated based on your background -->
**For Product Owner / Product Manager (payments & wallets) roles:** *[Used for: Visa_AccountWallet, Lebenslauf_EN]*
> Product Owner/Manager with 13+ years in digital payments, specialising in account, wallet, and card network products - owning backlogs, defining epics and user stories, and shipping features that process transactions at scale. Launched a Virtual Card wallet feature to 100% of eligible cardholders, processing 275,000+ transactions in 60 days with >95% sprint predictability across two scrum teams. Combines deep payments domain expertise (tokenisation, wallet integrations, card lifecycle) with commercial sharpness built across pre-sales solution architecture experience - thinking about product decisions in terms of customer value, adoption, and business outcome.

**For delivery-focused / AI-augmented Product Owner roles:** *[Used for: Wire, MarketplacePO]*
> Delivery-focused Product Owner with 13+ years in regulated, high-complexity environments - owning backlogs end-to-end, running agile rituals, writing epics and acceptance criteria, and protecting sprint scope across cross-functional engineering teams. Consistently achieves >95% sprint predictability across two scrum teams. Uses AI tooling (Gemini) daily to accelerate epic and story drafting, refine acceptance criteria, and improve stakeholder communication turnaround - treating AI as a force multiplier for delivery, not a novelty. Technically fluent from a Computer Science background, comfortable working closely with developers, tech leads, and QA to make confident delivery decisions.

Statements labeled *[Used for: <company>_<role>]* were extracted from archived application drafts by `/setup` Path A. They are **phrasing references, never fact sources**: when drafting from one, every factual claim still comes from `01-candidate-profile.md` - a past tailored draft does not vouch for its own accuracy. Note: Gemini is the AI tool actually used on the job (per every CV and the LinkedIn export) and must stay Gemini wherever the CV/cover letter describes on-the-job tool usage. CLAUDE.md's "reference Claude Code by name" rule applies only where the application separately and truthfully references this job-search workflow itself (e.g. a candidate who built this tracker) - it must never overwrite a real, differently-named on-the-job tool.

Statements labeled *[Used for: <company>_<role>]* were extracted from archived application drafts by `/setup` Path A. They are **phrasing references, never fact sources**: when drafting from one, every factual claim still comes from `01-candidate-profile.md` - a past tailored draft does not vouch for its own accuracy.

### Core Competencies / Skills Section (Best Practice)
Reorder and emphasize based on the role. Use bold category labels.

List **5-7 key competencies** in bullet format, tailored to the specific job. For each competency, briefly explain how it adds value to the position.

Use the posting's own core term in the matching bullet's bold label when it truthfully applies - ATS and skim-reading hiring managers match literally, and "MLOps" in a heading outperforms a paraphrase like "ML Deployment".

### Education
- Always include your highest degrees
- For senior roles, keep education brief (dates and titles only)
- Include thesis topics when relevant to the target role

#### In-progress qualifications must say so explicitly

**A bare year range is not enough.** An entry reading `2025–2026`, seen partway through 2026, looks like a *finished* degree, because a reader skimming a CV treats a closed range as closed. A profile statement that says "currently completing…" does not fix it: the education entry is where a reader checks the credential, so it has to stand on its own.

State completion inside the entry itself:

```latex
\item{\cventry{2025--2026}{[Degree], [Field]}{[Institution]}{[Location]}{}{\vspace{1pt}
In progress, expected [Month Year]. [Relevant topics]
}}
```

Any consistent form works: `In progress, expected <Month Year>.` / `Expected completion <Month Year>.` / a date field of `2025–present`.

Claiming a credential not yet held is a factual misstatement, and it is the kind discovered at transcript or reference check rather than at interview. It costs nothing to prevent. The same applies to in-progress certifications and courses.

**Check for agreement:** for a current student, the profile statement, the education entry, and any availability or work-permit note must all give the same completion date. Contradiction between them is worse than any single version.

### Professional Experience
- Rewrite bullet points to emphasize aspects most relevant to the target role
- Use 4-6 bullets for most recent role, 3-4 for previous, 2-3 for older
- **Emphasize measurable results** where possible: "Reduced processing time by X%", "Model adopted by the team"

#### Check tenure against visible output

Before finalizing, look at each role the way a stranger will: **date span versus how much work is shown.** A two-year role represented by a single project reads as low output, whether or not that is fair. The reader cannot know what filled the time, so they guess, and the guess is unflattering.

This bites hardest on **career changers** (part of the tenure went into learning the new field), on **long-cycle work** (industrial deployment, clinical or regulatory projects, research — one delivery genuinely takes quarters), and on anyone whose employer kept them on a single account or product.

Three honest fixes, in order of preference:

1. **Surface more real work.** Ask what else the period contained. There are often real secondary projects, internal tooling, or support work that never reached the CV because it felt minor. Best fix when the material exists.
2. **Make the phases within the role explicit.** If the span genuinely had stages, say so — an initial period learning the domain or supporting the team, then ownership of the named work through to delivery. A phased arc reads as a growth curve; an undifferentiated multi-year block reads as stagnation.
3. **Name what made the cycle long.** Data collection from a live environment, validation with domain experts, deployment and iteration against real output. Reviewers who know the domain accept this immediately.

**Never** pad with invented projects, and **never** quietly shorten the employment dates so the ratio looks better. Both are discoverable, and both are worse than the perception problem being solved.

**Prepare the interview answer too.** If a long span against little visible output survives these fixes, the question is coming. The candidate needs a ready two-part answer — what actually filled the time, and what the outcome was — recorded in their interview prep rather than improvised in the room.

### Handling Employment Gaps (Best Practice)
If there is a gap in your employment history:
- The gap should be explained matter-of-factly if needed
- Describe how professional development continued during the gap
- Frame as deliberate skill-building and career repositioning

### Publications
- Include Google Scholar link if applicable
- Select 3-4 most relevant publications (not always all of them)
- For non-academic roles, keep brief

### Evidence Links
Wherever the CV names a verifiable artifact - a public project, a hackathon entry, a publication - carry its link (`\href`) so a reader can verify the claim in one click. A CV whose strongest claims are checkable reads as more credible everywhere else too.

### Honors and Awards
- Keep format brief, one line each

### References
- List 2-4 references with name, title, company, and contact
- End with: "More references are available upon request."
- **Do not attach reference letters** - employers typically contact references directly

### LaTeX Special Characters (important)

Postings and profile data arrive as plain text; the CV is LaTeX. Escape these wherever they land in body text - company names, achievement bullets, skill lists:

| Character | Write | Typical trigger |
|---|---|---|
| `&` | `\&` | company names: Bang \& Olufsen, Brüel \& Kjær, H\&M |
| `%` | `\%` | quantified achievements: "cut latency by 40\%" |
| `$` | `\$` | salary and cost figures |
| `#` | `\#` | "ranked \#1", C\# |
| `_` | `\_` | file names, code identifiers |
| `~` | `\textasciitilde{}` | URLs, "approx. 5 years" tildes |
| `^` | `\textasciicircum{}` | version strings, math |

Two failure modes deserve special care:

- **`%` fails silently.** An unescaped `%` starts a LaTeX comment: the compile succeeds with zero errors, and everything after the `%` on that line vanishes from the PDF. `Cut inference latency by 40% and saved DKK 2M annually` renders as "Cut inference latency by 40" - the bullet keeps its impressive-looking fragment and loses the actual result. Quantified achievement bullets are exactly where the guidance steers you ("use numbers where possible"), so check every `%` in every bullet before compiling.
- **`&` fails loudly** inside `\cventry` (alignment-tab errors, `Missing } inserted`). The compile loop catches it, but escape employer names up front rather than debugging the compile.

Related trap: a bullet whose text begins with a literal `[` must be braced - `\item {[text]}` - or LaTeX parses the bracketed text as `\item`'s optional label and renders it clipped off the left page edge with a clean compile. The example CV's placeholder bullets are braced for exactly this reason.

## Compile-and-Inspect Loop (MANDATORY)

After writing the CV and before presenting to the user, always compile and visually inspect the PDF. Iterate until the layout is clean. Workflow:

1. Run `lualatex -interaction=nonstopmode main_<company>_<role>.tex`
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

**Caveat - use `\needspace` before entries, never before `\section` headings.** A section-level `\needspace` pushes the entire section (heading plus content) to the next page whenever the request does not fit, stranding empty space above and typically *adding* a page instead of saving one. Apply it only to the individual `\cventry` that actually orphans, and only after a compile shows the orphan.

**Problem: one trailing section spills to page 3 (e.g., References alone on page 3)**
Add `\enlargethispage{2-3\baselineskip}` before a late section (e.g., before `\section{Honors and Awards}`) to stretch page 2 by a few lines. This is the standard LaTeX rescue for near-miss overflows.

**Problem: 3 pages with significant content on page 3**
Cut content — do not compress geometry or `\vspace`. See "Relevance-weighted cutting" below for the rule.

**Problem: content finishes early on page 2 (feels thin)**
Restore the highest-relevance item that was previously cut — a CV that ends mid-page 2 looks incomplete.

## ATS Parseability

Most employers run CVs through an ATS before a human sees them, and the ATS reads the PDF's embedded **text layer**, not the rendered page. A CV can pass visual inspection and still extract as garbage. After the layout passes the compile-and-inspect loop, verify the text layer:

```bash
cd cv && pdftotext -layout -enc UTF-8 main_<company>_<role>.pdf main_<company>_<role>.txt
```

`pdftotext` comes from [poppler](https://poppler.freedesktop.org/), not the TeX distribution - it is an **optional** dependency. The `-enc UTF-8` flag is not optional: Xpdf-based `pdftotext` builds default to Latin-1 output, which makes every non-ASCII character in a perfectly good CV read back as a replacement character and fail the parseability check below for no real reason. If it is not installed, skip the mechanical check with a warning and rely on the visual PDF read for keyword coverage.

What to check in the extraction:

- **Contact details as literal text.** The stock template's fontawesome contact icons extract as glyph names (`MOBILE-ALT`, `Envelope`) - harmless noise, because the actual address and number are printed beside them. The failure mode is a contact detail carried *only* by an icon or a hyperlink (like the `LinkedIn` link text, whose URL is not in the text layer): invisible to an ATS. The email address must always appear as printed text.
- **No garbled output.** `(cid:NNN)` markers or `�` characters mean a font is embedded without a Unicode mapping - an ATS sees the same garbage. This shows up with unusual fonts in custom templates, not with the stock moderncv setup under lualatex.
- **Reading order.** The stock banking style is single-column, so extraction order matches visual order. Custom templates (via `/add-template`) with sidebars or multi-column layouts can interleave unrelated lines; if extraction order is scrambled, the user is trading ATS compatibility for looks and should be told.
- **Keyword coverage.** Match the posting's required/preferred terms against the extracted text, in the posting's language. Prefer the posting's exact term over a synonym when it is truthfully applicable - ATS matching is often literal. Never add a keyword the profile does not support.

### Date fields must be ASCII ranges (confirmed ATS import failure)

This one is worth knowing about because it fails **silently**. A CV that passes every other check in this section - clean extraction, no `(cid:)` markers, contact details intact, correct reading order - can still have its dates dropped on import. In a real Workday resume import, a CV built from this template lost the end date of a short contract role and failed to import **any** education entry at all, forcing manual re-entry. Nothing about the PDF or its text layer looked wrong.

Two independent causes, both easy to avoid:

1. **`--` in a `\cventry` date renders as an en-dash (U+2013), not a hyphen.** LaTeX ligatures `--` (two ASCII hyphens, U+002D) into a single en-dash glyph, so `2016--2024` reaches the PDF text layer as `2016<U+2013>2024`. Many parsers split date ranges only on an ASCII hyphen and see no range at all. Write the date argument with a **single hyphen**:

   ```latex
   \item{\cventry{2016-2024}{Role Title}{Organization}{Location}{}{...}}   % parses
   \item{\cventry{2016--2024}{Role Title}{Organization}{Location}{}{...}}  % en-dash, may not
   ```

   This applies to the **date argument only**. Keep `--` everywhere it is typographically correct in prose, for example a numeric range like `EUR 600k--1M`.

2. **A bare single year gives the parser no end date.** A short contract, mandate or internship written as `\cventry{2016}` imports as a start date with nothing to close it. Use an explicit range, with months where the role ran under a year:

   ```latex
   \item{\cventry{Mar 2016 - Jul 2016}{Contract Role}{Client}{Location}{}{...}}
   ```

   Where a genuine range exists, use it even when a single year would be factually accurate - a degree written `1995` is true but imports worse than `1992-1995`. Do not invent a start date you do not have; a lone graduation year is fine, just expect it to be typed in by hand.

**Add this to the step 5d checks**: after extracting the text layer, confirm every experience entry shows a start *and* an end separated by an ASCII hyphen. Because the failure is silent and invisible in the PDF, the candidate otherwise discovers it only while filling in the application form.

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
- **Never cut a whole role entry if doing so opens a gap in the employment timeline.** Cutting bullets within a role is fine; cutting the entire entry is not, if the role before it and the role after it don't connect in time — a visible gap reads far worse to a reader than a slightly denser page, and is exactly the kind of thing a recruiter screens for first. This actually happened: trimming a CV from 5 roles to 3 for space dropped the two pre-sales roles (2016-2022) entirely, leaving 2015 to 2022 unaccounted for. The fix, not "add the roles back at full length": **merge adjacent same-employer roles into one `\cventry`** spanning the combined date range, title joined with "\&" (e.g. "Pre-Sales Solution Architect \& Pre-Sales Lead", 2016-2022), keeping only the single strongest bullet from each merged role. This closes the gap in about the space one full entry would have taken. Check the full timeline for gaps as an explicit step before presenting any CV, not just page count.
- **Never silently drop an experience entry, even when it doesn't open a visible gap.** "No gap" is not the same as "complete." An entry can be missing from the CV while the surrounding dates still connect (e.g. because an Education entry happens to cover the same years) — that's still an undisclosed omission, not a safe cut. Name any dropped entry to the user explicitly before finalizing ("cutting the TCS/Java 2010-2012 entry to save space — OK?") rather than deciding silently on their behalf. This actually happened: the TCS Software Engineer (2010-2012) entry was dropped from the Lebenslauf master and propagated into 8 derived CVs — no timeline gap was visible because the 2012-2014 MBA entry sat right after it, so it went undetected through 3 submitted applications until the candidate caught it themselves.
- **Never build a new CV by trusting an existing template as ground truth.** Copying from `main_example.tex`, `main_example_lebenslauf.tex`, or any other already-drafted CV is a starting point for structure/format only — cross-check its actual content (every experience entry, every skill) against `01-candidate-profile.md` directly before relying on it. A master that's already missing something silently propagates the omission into everything derived from it, exactly as happened with the TCS entry above (the master itself had already dropped it, from copying `main_example.tex`, which was also incomplete).

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
