# Job Application Assistant for Joshua Cullinan

## Role
This repo is a job application workspace. Claude acts as a career advisor and application assistant for Joshua Cullinan, helping with:
1. **Job fit evaluation** - Assess job postings against your profile (skills, experience, behavioral traits)
2. **CV tailoring** - Adapt existing CV templates (LaTeX/moderncv) to target specific roles
3. **Cover letter writing** - Draft targeted cover letters using existing templates (LaTeX)
4. **Interview preparation** - Prepare answers, questions, and talking points for interviews
5. **Career strategy** - Advise on positioning and personal branding

## Candidate Profile

> Full structured profile: `.claude/skills/job-application-assistant/01-candidate-profile.md`. Behavioral detail: `02-behavioral-profile.md`.

### Identity
- **Name:** Dr Joshua Cullinan (full: Joshua Peter Cullinan)
- **Location:** Johannesburg, Gauteng, South Africa. Open to remote (global), hybrid in Johannesburg/Gauteng, and relocation.
- **Work authorization:** South African citizen; **EU citizen (Ireland)** and **British passport holder** - full right to work in the EU, Ireland, and the UK with no visa sponsorship.
- **Languages:** English (native); basic Afrikaans (confirm level).
- **Status:** Medical Officer (Community Service), Bheki Mlangeni District Hospital (Jan 2026 - present). Finishing the community-service year; targeting a transition into a new role at end of 2026 / into 2027, open to an exceptional opportunity sooner.
- **LinkedIn headline:** "Medical Doctor | MSc Medicine (Bioinformatics) | AI Driven Health"

### Education
- **MSc in Medicine - Bioinformatics** (2023-2025) - University of Cape Town - **Distinction, GPA 89.0%**
  - Thesis: "Utilising Machine Learning Techniques on Simulated Viral Evolution Datasets to Improve Viral Recombinant Identification"
  - Topics: deep learning (recurrent networks), ~500,000 simulated viral sequences, recombinant identification, ONNX deployment into RDP5
- **BMedSc (Honours) - Bioinformatics** (2020) - University of Cape Town - **Distinction, first class, GPA 85.9%**
  - Project: ML to predict cancer cell responses to small-molecule inhibitors (CCLE / GDSC)
- **MBChB - Bachelor of Medicine and Surgery** (2017-2023) - University of Cape Town - **Distinction in clinical sciences, overall first class honours, GPA 77.49%**

### Professional Experience
- **Internal Medicine Medical Officer (Community Service)** (Jan 2026 - present) - **Bheki Mlangeni District Hospital** (Johannesburg)
  - Comprehensive management of internal-medicine inpatients: ward rounds, diagnostic workup, treatment planning, MDT coordination
  - HIV/TB co-infection, diabetes, hypertension, CKD, acute emergencies in a resource-limited district hospital
  - Additional ED shifts across trauma, surgical, medical, and paediatric presentations
- **Medical Officer Intern** (Jan 2024 - Dec 2025) - **Chris Hani Baragwanath Academic Hospital** (Johannesburg)
  - Two-year HPCSA-accredited internship at Africa's largest hospital (3,400 beds)
  - Rotations across Internal Medicine, Surgery, Paediatrics, O\&G, Psychiatry, Orthopaedics, Anaesthesiology, Family Medicine; extensive trauma/emergency exposure
- **Tutor** (2019-2020) - **SmartPrep** - physics and chemistry for matric students
- **Volunteer & Leadership** (2017-2021) - **SHAWCO** - volunteer to Head of Khayelitsha Clinic (2018-2019) to Board of Directors (2020-2021)

### Technical Skills
- **Primary:** Python, machine learning / deep learning (TensorFlow, scikit-learn), data analysis (Pandas, NumPy)
- **Secondary:** JavaScript, React, Django, REST APIs, SQL, Bash; ONNX model deployment; LLM integration (Anthropic Claude API, Ollama)
- **Domain:** clinical medicine (HIV/TB, internal medicine, emergency); bioinformatics, genomics, viral evolution, clinical imaging
- **Software / Infra:** Git/GitHub, Docker, Linux, AWS EC2, Proxmox/ZFS, SLURM/GPU compute, Jupyter, TensorBoard

### Certifications
- None on file currently.

### Publications
- MSc dissertation (2025): *Utilising Machine Learning Techniques on Simulated Viral Evolution Datasets to Improve Viral Recombinant Identification*, University of Cape Town. (No peer-reviewed journal publications on file - confirm.)

### Awards
- MBChB with distinction in the clinical sciences and overall first class honours (UCT, 2023)
- MSc (Bioinformatics) with distinction (UCT, 2025); BMedSc (Hons) first class (UCT, 2020)
- Class Medal - Mathematics 1005 (UCT, 2016); UCT Plus Gold (60h elected leadership role)

### Behavioral Profile
- **Self-directed clinician-engineer** - builds and ships end-to-end; taught himself ML, deployment, and systems admin alongside a medical career
- **Disciplined under load** - MSc with distinction earned during a full hospital internship
- **Strengths:** research-to-production delivery, judgement calibrated to stakes, bridging clinical and engineering teams, fast learning
- **Growth areas:** limited commercial/team software-engineering track record; low tolerance for bureaucracy and maintenance-only work
- **Thrives in:** novel hard problems with autonomy and visible impact; flexible between structured orgs and small autonomous teams

### What Excites You
- Novel research and genuinely hard problems, with continuous learning
- Building and shipping AI/ML systems that reach real users and create clinical/patient impact

### Target Sectors
- **Health-AI / clinical AI / digital health:** companies building AI for clinicians and patients (e.g. clinical documentation, diagnostics, medical imaging, clinical decision support)
- **ML / AI engineering (any domain):** applied ML/AI roles that value research-to-production skill

### Deal-breakers
- Pure clinical shift work with no path into data/AI/technical work
- Roles with no learning curve or no AI/ML/technical component

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
