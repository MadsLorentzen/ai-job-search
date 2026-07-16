# Job Application Assistant for Harsh Tyagi

<!-- SETUP: This file is populated by running /setup -->
<!-- After running /setup, all [PLACEHOLDER] tokens will be replaced with your actual information -->

## Role
This repo is a job application workspace. Claude acts as a career advisor and application assistant for [YOUR_NAME], helping with:
1. **Job fit evaluation** - Assess job postings against your profile (skills, experience, behavioral traits)
2. **CV tailoring** - Adapt existing CV templates (LaTeX/moderncv) to target specific roles
3. **Cover letter writing** - Draft targeted cover letters using existing templates (LaTeX)
4. **Interview preparation** - Prepare answers, questions, and talking points for interviews
5. **Career strategy** - Advise on positioning and personal branding

## Candidate Profile

<!-- This section is auto-populated by /setup. You can also fill it in manually. -->

### Identity
- **Name:** Harsh Tyagi
- **Location:** Ghaziabad / Noida, Uttar Pradesh, India
- **Phone:** +91 9650541334
- **Email:** tyagiharshit2539@gmail.com
- **LinkedIn:** linkedin.com/harshtyagi25
- **GitHub:** github.com/Harshit2539
- **Languages:** English, Hindi
- **Status:** Employed (Software Development Engineer at Redian Software Global Pvt. Ltd., open to opportunities)
- **LinkedIn headline:** "Software Development Engineer | React.js · Node.js · Laravel · AI/ML · Computer Vision"

### Education
- **B.Tech in Computer Science (AI & ML)** (Aug 2021 – Jun 2025) - R.D. Engineering College (RDEC), Ghaziabad, UP
  - CGPA: 8.05 / 10.00
- **Senior Secondary (Class XII) – PCM** (Aug 2021) - Mount Carmel School, Muradnagar, Ghaziabad
  - CGPA: 7.50 / 10.00

### Professional Experience
- **Software Development Engineer** (Jan 2025 – Present) - **Redian Software Global Pvt. Ltd.** (Noida Sector 63, UP)
  - Designed and maintained scalable web apps using PHP/Laravel (routing, middleware, auth, DB schemas)
  - Built AI-driven construction tech platforms: automated quantity take-off system + AI tender prediction SaaS
  - Trained custom AI/ML models (YOLOv8/v11-seg) for image-based domain datasets (room windows, floor plans)
  - Applied LLM prompt engineering and n8n workflow automation for AI-powered modules
  - Full-stack: PHP (Laravel), React.js, Node.js, Express.js, MongoDB, SQL, Python, Computer Vision, Bootstrap, Tailwind CSS

- **Software Engineer Intern** (Jul 2024 – Dec 2024) - **MaiVin Consulting Services Pvt. Ltd.** (Greater Noida, UP)
  - SQL and SAP HANA SQL for enterprise data querying and analysis
  - Crystal Reports for business/analytical reporting supporting SAP Business One implementations
  - Foundational Java development exposure

### Technical Skills
- **Languages:** C, Java, Python, JavaScript (ES6+), PHP
- **Web/Backend:** React.js, Node.js, Express.js, PHP (Laravel), FastAPI, REST APIs, HTML5, CSS3, Bootstrap, Tailwind CSS
- **Databases:** MongoDB, MySQL, PostgreSQL
- **AI/ML:** Applied ML, Neural Networks, Computer Vision (YOLOv8, v11-seg), Image Annotation, Dataset Curation, Custom Model Training, Model Fine-tuning, LLM Prompt Engineering, n8n Workflow Automation
- **Security/Backend:** JWT Auth, Encryption/Decryption, API Design, DB Normalization
- **Data/BI:** SAP Business One, Crystal Reports
- **DevOps/Tools:** Git, GitHub, Docker, AWS

### Certifications
- AWS Cloud Practitioner – Foundations
- Google Cloud Computing Foundations
- Meta (Coursera) – Version Control
- HackerRank – Java (4★)
- Applied Machine Learning & Computer Vision (Project-Based)

### Publications
- None

### Awards
- None listed

### Behavioral Profile
- **Builder mindset** – Enjoys taking projects from concept to production, not just maintaining existing systems
- **Technical breadth** – Comfortable across full stack (frontend, backend, AI/ML, DevOps)
- **Strengths:** End-to-end SaaS development, AI integration, problem-solving across layers
- **Growth areas:** System design at scale, team leadership, open-source contributions
- **Thrives in:** Product-focused teams, roles with ownership, environments that value AI/ML innovation

### What Excites You
- Building AI-powered products that solve real-world problems (construction tech, document intelligence, LMS)
- Integrating cutting-edge ML/CV models into production SaaS platforms
- Full-stack ownership from model training to user-facing dashboard

### Target Sectors
- AI/ML Product Companies: startups and scale-ups building AI-first products
- SaaS Platforms: multi-tenant B2B SaaS (EdTech, ConstructionTech, HRTech, LegalTech)
- Full-Stack / Backend Engineering roles with AI integration component

### Deal-breakers
- Roles with zero AI/ML or modern tech stack involvement
- Purely maintenance/legacy-only work with no product development

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
