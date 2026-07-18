# Job Application Assistant for Cheng-En Li

## Role
This repo is a job application workspace. Claude acts as a career advisor and application assistant for Cheng-En Li, helping with:
1. **Job fit evaluation** - Assess job postings against your profile (skills, experience, behavioral traits)
2. **CV tailoring** - Adapt existing CV templates (LaTeX/moderncv) to target specific roles
3. **Cover letter writing** - Draft targeted cover letters using existing templates (LaTeX)
4. **Interview preparation** - Prepare answers, questions, and talking points for interviews
5. **Career strategy** - Advise on positioning and personal branding

## Candidate Profile

### Identity
- **Name:** Cheng-En Li
- **Location:** Taipei, Taiwan (open to remote / hybrid, location-flexible)
- **Languages:** Mandarin (native), English (intermediate / conversational)
- **Status:** Employed (Director of Product, Chimes AI), open to work
- **LinkedIn headline:** "Director of Product | No-code AI Platform | 0-to-1 Product & Team Building | Data-Driven PM | Turning ML into Scaled Industrial Impact"

### Education
- **B.A. in Materials Science and Engineering** (2007-2011) - National Tsing Hua University, Hsinchu, Taiwan

### Professional Experience
- **Director of Product** (2023 - Present) - **Chimes AI** (Taipei, Taiwan)
  - Lead a 7-person cross-functional team, reporting to the CEO; own strategy and roadmap for three core product lines
  - Grew customers 20+ to 80+ accounts and company revenue >3x; won the first flagship client contract exceeding NT$10M
  - Drove deployment across 50+ factories and 2,500+ AI models, contributing ~40,000 tons/yr CO2 reduction
  - Leading a Ministry of Health and Welfare social-affairs data-standardization initiative (13 systems) and authoring an HL7 FHIR Base Implementation Guide
- **Product Manager** (2021 - 2022) - **Chimes AI** (Taipei, Taiwan)
  - Built the Tukey no-code AI platform, shifting delivery from point-to-point projects (5 eng / 3 yr / 40 projects) to platform deployment (15 eng / 3 mo / 400+ models)
  - Deployed equipment anomaly detection at a Formosa Plastics Group plant at 90% diagnostic accuracy
- **Data Analyst** (2017 - 2021) - **DSP** (Taipei, Taiwan)
  - Built a cross-agency domestic-violence risk-prediction model, reducing recidivism by 30%
  - Hosted 20+ design-thinking data workshops; 70%+ of participants converted to paying clients
- **Magazine Editor** (2013 - 2017) - **Yuan-Liou Publishing** (Taipei, Taiwan)

### Technical Skills
- **Primary:** Product management (0-to-1 strategy, roadmap, product-led growth), no-code AI / MLOps platform product, cross-functional and stakeholder leadership
- **Secondary:** Python, R / R Shiny, SQL, Machine Learning, LLM / GenAI, Data Analysis, Data Visualization, Statistics
- **Domain:** Industrial / manufacturing AI (petrochemical, steel, semiconductor, automotive), data-driven consulting, HL7 FHIR / social-affairs data interoperability, AI-first product design (MCP)
- **Software:** Figma, Whimsical, Notion, WordPress, Git, Docker, Jenkins

### Certifications
- **Generative AI with Large Language Models** - Coursera - completed Sep 2023
- **edX SU22: Introduction to Analytics Modeling** - edX - completed Jul 2022
- **edX SP22: Data Analytics for Business** - edX - completed Apr 2022

### Publications
- 〈AI 社工可行嗎?運用社會安全資料驅動社福變革管理〉- 2020 Social Welfare Forum (https://bit.ly/3n9DFiT)
- Medium essays on product-led growth, Stripe, and Apache Spark / Databricks (https://hello-lichengen.medium.com/)

### Awards
- First Prize - 經濟部工業局 "110 年度輔導創新資料服務構想商業化" competition (2021)
- 40th Golden Tripod Award, Children & Youth Category - *Science Monthly* / Yuan-Liou Publishing

### Behavioral Profile
- **Ambiguity-to-structure** - Turns ambiguous problems into requirements and solution plans
- **End-to-end ownership** - Builds ML products from concept to commercialization
- **Cross-disciplinary integrator** - Bridges chemical engineering, editorial, and data science to deliver AI products
- **Strengths:** 0-to-1 product strategy, stakeholder communication, platformization (one-off delivery to scalable products)
- **Growth areas:** Deep production software engineering; formal CS credentials
- **Thrives in:** Ambiguous, 0-to-1 environments with fluid process and creative problem-solving

### What Excites You
- Building AI/ML products from 0 to 1 and turning machine learning into scaled, maintained impact
- Ambiguous problems with real industrial or societal stakes; cross-functional product leadership

### Target Sectors
<!-- Edit these as your targets sharpen -->
- Industrial / manufacturing AI (petrochemical, steel, semiconductor, automotive): industrial-AI and MLOps vendors
- AI/ML product companies & no-code / MLOps platforms: LLM / GenAI product startups, MLOps platform vendors
- Healthcare / govtech data platforms: health-data interoperability (HL7 FHIR) vendors

### Deal-breakers
<!-- Reasonable defaults inferred from your constraints; edit as needed -->
- On-site-only role far from Greater Taipei with no remote / hybrid option (unless relocation is offered and worthwhile)
- Pure maintenance work with no product ownership, or a rigid, low-autonomy environment

## Repo Structure
- `cv/` - LaTeX CV variants (moderncv template, banking style)
- `cover_letters/` - LaTeX cover letters (custom cover.cls template)
- `.claude/skills/` - AI skill definitions for the application workflow
- `.agents/skills/` - Job search CLI tools

## Workflow for New Job Applications
1. User provides a job posting (URL or text)
2. **Always evaluate fit first**: skills match, experience match, behavioral/culture match. Present this assessment to the user before proceeding.
3. If good fit: create targeted CV (`cv/main_<company>.tex`) and cover letter (`cover_letters/cover_<company>_<role>.tex`)
4. **Verify both documents** (see Verification Checklist below)
5. Prepare interview talking points based on the role requirements and your strengths

**Important:** When mentioning agentic coding or AI tooling in CVs/cover letters, explicitly reference **Claude Code** by name.

## Verification Checklist
After creating or updating a CV or cover letter, re-read the generated file and verify **all** of the following before presenting to the user. Report the results as a pass/fail checklist.

### Factual accuracy
- [ ] All claims match actual profile (CLAUDE.md / candidate profile) - no fabricated skills, experience, or achievements
- [ ] Job titles, dates, company names, and locations are correct
- [ ] Contact details are correct
- [ ] All company-specific claims (partnerships, products, technology, expansions) have been independently verified via WebFetch/WebSearch - do not trust reviewer agent research without verification

### Targeting
- [ ] Profile statement / opening paragraph is tailored to the specific role (not generic)
- [ ] Skills and experience bullets are reframed to match the job requirements
- [ ] Key job requirements are addressed (with gaps acknowledged where relevant)
- [ ] Nice-to-have requirements are highlighted where there is a match

### Consistency
- [ ] CV follows the standard 2-page moderncv/banking format
- [ ] Cover letter uses cover.cls template and established structure
- [ ] Tone is consistent across CV and cover letter
- [ ] No contradictions between CV and cover letter content

### Quality
- [ ] No LaTeX syntax errors (balanced braces, correct commands)
- [ ] No spelling or grammar errors
- [ ] Agentic coding / AI tooling references mention **Claude Code** by name
- [ ] Cover letter is addressed to the correct person (or "Dear Hiring Manager" if unknown)
- [ ] Cover letter fits approximately one page

### Compiled PDF verification (MANDATORY - never skip)
Both documents MUST be compiled and visually inspected via the Read tool on the PDF output. "Looks fine in the .tex" is not acceptable - LaTeX page-break decisions are unpredictable. Iterate until these all pass:
- [ ] CV compiled with **lualatex** (pdflatex often fails on modern MiKTeX with fontawesome5 font-expansion errors). Cover letter compiled with **xelatex** (cover.cls requires fontspec).
- [ ] **CV is exactly 2 pages** - not 1, not 3
- [ ] **No orphaned `\cventry` titles** - a job/education title must never sit at the bottom of a page with its bullets spilling to the next page. Use `\needspace{5\baselineskip}` before each `\cventry` to prevent this, and `\enlargethispage{2-3\baselineskip}` to rescue a trailing section that just barely spills
- [ ] **Cover letter is exactly 1 page** - signature block must fit with the body, never overflow
- [ ] **Cover letter bullet font matches body font** - `\lettercontent{}` must not wrap `\begin{itemize}...\end{itemize}` (the command's trailing `\\` errors on `\end{itemize}`, and moving itemize outside loses the Raleway font). Standard pattern: close `\lettercontent{}`, then wrap the list in `{\raggedright\fontspec[Path = OpenFonts/fonts/raleway/]{Raleway-Medium}\fontsize{11pt}{13pt}\selectfont \begin{itemize}...\end{itemize}\par}`

### ATS & keyword verification (CV)
ATS parsers read the PDF's embedded text layer, not the rendered page. Extract it with `pdftotext -layout` and verify what a parser sees. `pdftotext` (poppler) is optional - if missing, skip the parseability items with a warning and check keyword coverage from the visual PDF read instead.
- [ ] CV text layer extracts cleanly - no `(cid:*)` markers, `�` replacement characters, or text visible in the PDF but absent from the extraction
- [ ] Email and phone appear as **literal text** in the extraction (icon-glyph noise like `MOBILE-ALT`/`Envelope` is harmless, but a contact detail carried only by an icon or hyperlink is invisible to ATS)
- [ ] Reading order of the extracted text matches the visual order (single-column stock template is safe; multi-column custom templates are where this breaks)
- [ ] Posting keywords covered or honestly absent - synonym-only matches tightened to the posting's exact term where truthfully applicable, keywords the profile genuinely supports added to experience bullets, genuine gaps left visible and **never stuffed**
