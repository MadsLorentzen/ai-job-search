# Job Application Assistant for Silvia Giammarinaro

## Role
This repo is a job application workspace. Claude acts as a career advisor and application assistant for Silvia Giammarinaro, helping with:
1. **Job fit evaluation** - Assess job postings against your profile (skills, experience, behavioral traits)
2. **CV tailoring** - Adapt existing CV templates (LaTeX/moderncv) to target specific roles
3. **Cover letter writing** - Draft targeted cover letters using existing templates (LaTeX)
4. **Interview preparation** - Prepare answers, questions, and talking points for interviews
5. **Career strategy** - Advise on positioning and personal branding

## Candidate Profile

### Identity
- **Name:** Silvia Giammarinaro
- **Location:** Berlin, Germany (applying to Berlin-based roles)
- **Phone:** +49 1705046633
- **Email:** silvia.giammarinaro@gmail.com
- **LinkedIn:** https://www.linkedin.com/in/silvia-giammarinaro
- **Languages:** Italian (native), English (C1), German (A2)
- **Status:** Currently employed at Aignostics (Software Engineer, Backend, Feb 2025–present); actively seeking new role
- **LinkedIn headline:** "Software Engineer | Data engineer | Health tech"

### Education
- **MSc in Data Science and Engineering** (Oct 2019 – Dec 2021) — Politecnico di Torino, Turin, Italy
  - GPA: 3.8/4, Grade: 109/110
  - Thesis: "Exploiting background knowledge for scene graph generation with Logic Tensor Networks"
  - Topics: machine learning, data engineering, computer vision, knowledge representation
  - Founded MALTO (Machine Learning Torino Politecnico) student team
- **BSc in Computer Engineering** (Oct 2016 – Aug 2019) — Politecnico di Torino, Turin, Italy

### Professional Experience
- **Software Engineer, Backend** (Feb 2025 – present) — **Aignostics** (Berlin, Germany)
  - Pipelines for 1PB+ medical imaging data (Python, GCP); distributed processing via Ray jobs on Kubernetes; hospital partner onboarding (~20k+ pathology slides)
  - GCP infrastructure for new backend integration service; ADR coordinating 5+ teams; serverless event-driven architecture (Cloud Run + PostgreSQL job queue)
  - Data cleanup across multiple DBs and cloud storage; €4k+/month savings
  - MR reviews, incident response, DuckLake presentation, EuroPython; deployment changelogs, progress dashboards
- **Data Engineer, Link** (Apr 2024 – Feb 2025) — **Veeva Systems** (Berlin, Germany)
  - Scalable pipelines for 300M+ records (PySpark, Airflow, AWS data lakes); Terraform for AWS infra; 5TB+ S3 savings
- **Data Analyst, Link Key Accounts / Data Operations** (Feb 2023 – Apr 2024) — **Veeva Systems** (Berlin, Germany)
  - Automated reporting: 85%+ time saved, 10+ Airflow processes, 20+ Superset dashboards
  - Pipeline revamp ~90% efficiency gain; 60+ tables across 2 DBs; mentored analysts in Python/AWS/Airflow
- **Data Analyst, CRM** (Sep 2021 – Feb 2023) — **mytheresa.com** (Munich, Germany)
  - Automated CPM reports: 93% reduction in creation time; ML segmentation for customer targeting
- **Teaching Assistant** (Oct 2020 – Jan 2021) — **Politecnico di Torino** (Turin, Italy)
  - ML for Vision & Multimedia course; 40+ students, 10+ labs
- **Junior Software Engineer** (Sep 2019 – Sep 2020) — **SAN srl** (Collegno, Italy)
- **Software Engineer Intern** (Mar 2019 – May 2019) — **SAN srl** (Turin, Italy)

### Technical Skills
- **Primary:** Python (expert), SQL (expert), Apache Airflow, PySpark, data engineering / ETL pipeline design
- **Secondary:** R, AWS (S3, Redshift, Terraform), GCP (Cloud Run, Cloud Storage), Docker, Terraform, Kubernetes (deploying distributed Ray jobs)
- **Domain:** Data engineering, analytics engineering, backend software engineering, medical imaging data (current), e-commerce analytics (past), ML/AI (academic + applied)
- **Software:** PostgreSQL, Redshift, MongoDB, Apache Superset, Looker, Tableau, PyTorch, Keras, TensorFlow, Scikit-learn, Pandas, NumPy

### Certifications
- **MLOps Specialization** — deeplearning.ai, completed December 29, 2023
- **AWS Certified Cloud Practitioner** — issued September 14, 2023

### Publications
- None

### Awards
- **First place, Easy Peasy Robotics Competition** — Workshop by Istituto Italiano di Tecnologia (Computer Vision), during MSc

### Behavioral Profile
- **Initiative and ownership** — works autonomously, end-to-end identification with responsibilities
- **Technical precision** — solves complex problems carefully; "extremely precisely at all times" (reference letter, mytheresa)
- **Resilience** — maintains quality under stress; was on-call weekends at mytheresa
- **Collaborative** — invests in colleagues through mentoring; puts team interests forward
- **Continuous learner** — multiple certifications while working full-time; proactively expands skills
- **Strengths:** Pipeline architecture, stakeholder delivery (up to director level), mentoring, measurable impact
- **Growth areas:** [To be collected — run /setup --section career]
- **Thrives in:** Clear ownership, high technical standards, collaborative teams, real-world impact

### What Excites You
- Hard engineering problems with real-world consequences (health tech, science, climate, data infrastructure)
- Scale and growing into more senior scope — staff engineer / tech lead trajectory
- Startup and founding energy: small teams, broad ownership, possibility of equity

### Target Sectors
- Health tech / medical imaging: Aignostics (current), similar companies
- Any sector with interesting data engineering problems at scale (fintech, climate, AI tooling)
- Early-stage startups and scale-ups in Berlin where engineering scope is broad

### Deal-breakers
- Roles requiring relocation outside Berlin
- Fully remote (wants in-person or hybrid with regular office time)
- Below €70k salary

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
- [ ] Both documents compiled with **tectonic** (`tectonic <file>.tex`, run from inside `cv/` or `cover_letters/`) — the engine verified to work on this machine; `lualatex`/`xelatex` are not installed here. (On a full TeX install, the CV uses lualatex and the cover letter xelatex.) A patched `fontawesome5-utex-helper.sty` in `cv/` and `cover_letters/` is required for moderncv to compile under tectonic — do not delete it. Generated CVs omit the `\firstnamestyle`/`\lastnamestyle`/`\sectionstyle` overrides (moderncv 2022 colours these natively) and wrap `\hypersetup` in `\AtBeginDocument{}`. Full fix: SETUP.md → "LaTeX compilation errors".
- [ ] **CV is exactly 2 pages** - not 1, not 3
- [ ] **No orphaned `\cventry` titles** - a job/education title must never sit at the bottom of a page with its bullets spilling to the next page. Use `\needspace{5\baselineskip}` before each `\cventry` to prevent this, and `\enlargethispage{2-3\baselineskip}` to rescue a trailing section that just barely spills
- [ ] **Cover letter is exactly 1 page** - signature block must fit with the body, never overflow
- [ ] **Cover letter bullet font matches body font** - `\lettercontent{}` must not wrap `\begin{itemize}...\end{itemize}` (the command's trailing `\\` errors on `\end{itemize}`, and moving itemize outside loses the Raleway font). Standard pattern: close `\lettercontent{}`, then wrap the list in `{\raggedright\fontspec[Path = OpenFonts/fonts/raleway/]{Raleway-Medium}\fontsize{11pt}{13pt}\selectfont \begin{itemize}...\end{itemize}\par}`
