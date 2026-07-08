# Job Application Assistant for Jesus Mejia Arcila

## Role
This repo is a job application workspace. Claude acts as a career advisor and application assistant for Jesus Mejia Arcila, helping with:
1. **Job fit evaluation** - Assess job postings against your profile (skills, experience, behavioral traits)
2. **CV tailoring** - Adapt existing CV templates (LaTeX/moderncv) to target specific roles
3. **Cover letter writing** - Draft targeted cover letters using existing templates (LaTeX)
4. **Interview preparation** - Prepare answers, questions, and talking points for interviews
5. **Career strategy** - Advise on positioning and personal branding

## Candidate Profile

### Identity
- **Name:** Jesus Mejia Arcila
- **Location:** San Jose, Costa Rica (open to remote and roles across Costa Rica; not open to relocation)
- **Languages:** Spanish (Native), English (Professional Working Proficiency, B2)
- **Status:** Employed full-time (CRG Solutions), concurrently finishing Bachelor's degree
- **LinkedIn headline:** "Full-Stack Developer | Systems Engineering Student"

### Education
- **Bachelor's Degree in Computer Systems Engineering** (2023-Present) - Universidad Fidelitas (UFide), San Jose, Costa Rica
- **High School Diploma & Technical Degree, Service Center Executive** (2019-2021) - Colegio Tecnico Profesional de Pavas

### Professional Experience
- **IT Technical Support Specialist** (February 2025 - Present) - **CRG Solutions (on-site at Heineken)** (San Jose, Costa Rica)
  - Provide technical IT support for Heineken operations, resolving hardware, software, and connectivity incidents
  - Diagnose and escalate issues following ITIL-aligned support procedures
  - Independently designed and developed the company's internal corporate portal (Next.js, Vercel) covering hardware inventory, software catalog with approval workflows, knowledge base, and Microsoft OAuth authentication
- **Business Technologies Automation Intern** (March 2025 - September 2025) - **Bimbo Global Services**
  - Developed and deployed internal applications using Power Apps and Power Pages with Dataverse and SharePoint
  - Automated internal workflows with Power Automate, reducing request and reservation management turnaround time
  - Designed end-to-end solutions for internal ticketing, parking/cubicle reservations, and digital inspections across DEV, QA, and PROD environments
- **Administrative Intern** (October 2021 - December 2021) - **Office of the Attorney General of the Republic**
  - Managed and digitized the institution's physical and digital document archives
  - Improved retrieval times and contributed practical improvements to document management workflows

### Technical Skills
- **Primary:** Python (FastAPI), JavaScript/TypeScript (React 19, Next.js 15), C# (ASP.NET Core), Java (Spring Boot)
- **Secondary:** Docker, GitHub Actions (CI/CD), Azure SQL Server (T-SQL), MySQL, JWT/Microsoft SSO/Row-Level Security, Groq API/Llama 3
- **Domain:** Full-stack web development (solo end-to-end delivery), business process automation (Power Platform), multi-tenant SaaS architecture, IT technical support (ITIL-aligned)
- **Software:** Power Apps, Power Automate, Power Pages, Dataverse, SharePoint, Git/GitHub, Microsoft Office

### Certifications
None yet.

### Publications
None yet.

### Awards
None yet.

### Behavioral Profile
See `.claude/skills/job-application-assistant/02-behavioral-profile.md` (not yet completed - run `/setup --section behavioral` or answer interview-mode questions to fill this in).

### What Excites You
- Owning full-stack projects end-to-end with more scale and autonomy
- Specializing further in applied AI/LLM integration (chatbots, LLM-powered features)
- Deepening business process automation / Power Platform specialism

### Target Sectors
- Full-stack / software engineering roles (Costa Rica and remote)
- IT automation / Power Platform roles
- AI-integration-adjacent full-stack roles

### Deal-breakers
- Roles requiring relocation

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
