# Job Application Assistant for Thomas Adair

<!-- PRE-POPULATED 2026-06-24 from Thomas_Adair_Resume_v2.docx + Master_Inventory.docx -->
<!-- Civilian translation: Department of War (not DoD), Federal Correctional Facility, MCMAP dropped -->

## Role
This repo is a job application workspace. Claude acts as a career advisor and application assistant for Thomas Adair, helping with:
1. **Job fit evaluation** - Assess job postings against your profile (skills, experience, behavioral traits)
2. **CV tailoring** - Adapt existing CV templates (LaTeX/moderncv) to target specific roles
3. **Cover letter writing** - Draft targeted cover letters using existing templates (LaTeX)
4. **Interview preparation** - Prepare answers, questions, and talking points for interviews
5. **Career strategy** - Advise on positioning and personal branding

## Candidate Profile

<!-- This section is auto-populated by /setup. You can also fill it in manually. -->

### Identity
- **Name:** Thomas Adair
- **Email:** adair.thomas@gmail.com
- **Location:** Oceanside, CA (North County San Diego)
- **Languages:** English (native)
- **Status:** Active U.S. Marine Corps service — transition projected 2028; SkillBridge eligible in final 180 days
- **Clearance:** Active Secret (eligible Top Secret upgrade); protected veteran; no visa sponsorship needed
- **LinkedIn:** linkedin.com/in/thomasadair
- **GitHub:** github.com/AdairBear
- **Location constraints:** Remote (CA-based) preferred; in-office SD/LA/Bay Area OK; NO relocation; NO in-office non-CA
- **LinkedIn headline:** "Operations & Compliance Leader · AI Systems Builder · Active Secret Clearance"

### Education
- **B.S. in Business Project Management** (in progress) - American Military University
- **Strategic Leadership, Operations Management, Organizational Leadership** - Marine Corps University
- **Strategic Planning Systems** - Joint Forces Staff College
- PME through E-6 (Staff Sergeant level)

### Professional Experience
- **Senior Operations & Compliance Manager** (2022–Present) - Federal Correctional Facility, Camp Pendleton, CA (Employer: U.S. Marine Corps / Dept. of War)
  - 100% inspection pass rate; corrective-action program cut violations 15% YoY
  - Executive KPI reporting, compliance dashboards, 40+ parole/clemency cases annually
  - 5 direct reports, 20+ cross-functional stakeholders; 8 rehabilitative programs
- **Talent Acquisition Specialist** (2019–2022) - Federal Government Recruiting, SF Bay Area (Employer: U.S. Marine Corps / Dept. of War)
  - ~50 full-cycle placements; mentorship program +30% completion rate
  - 100% documentation compliance; standardized workflows cut processing errors 20%
- **Operations Manager** (2016–2019) - Federal Correctional Facility, Chesapeake, VA — Dept. of War / Navy-operated (Employer: U.S. Marine Corps)
  - Led ACA accreditation (one of only two accredited Marine Corps facilities)
  - 459 standardized operating procedures; 200+ hours compliance training to 110+ employees
  - $100K+ procurement; $33K vendor-negotiation savings; 30+ employees supervised
- **Security Operations & Corrections Specialist** (2008–2016) - Camp Pendleton, CA / Afghanistan (Employer: U.S. Marine Corps)
  - Two deployments Afghanistan (2009, 2012)
  - 80+ structured interviews, 30+ climate surveys across 1,500+ employees

### Technical Skills
- **AI/ML:** Multi-agent orchestration (Anthropic Claude + MCP), LLM deployment, parity validation, drift detection, automated kill switches, audit gates, RAG/pgvector memory, 150+ automated test suites, CI/CD
- **Engineering:** Python, FastAPI, Pine Script v5/v6, React/Vite, Node.js, JUCE/C++, PostgreSQL/pgvector, Redis, Docker, Linux/systemd, WebSockets, Pandas/NumPy, ML (CNN/HMM/time-series)
- **Domain:** National security/defense, regulated-environment operations, GovTech compliance, fintech/algorithmic trading
- **Tools:** Claude Code, Anthropic API, OpenAI API, Groq API, Ollama, Databento MDP3.0, Tauri, Stripe, Clerk

### Certifications
- ACA (American Correctional Association) — accreditation lead
- SAPR Victim Advocate — certified, 5 years
- Certified defensive-tactics and use-of-force instructor
- Senior on-call incident commander (24/7 rotation)

### Publications
- None for direct submission.

### Awards
- TODO: Add any formal USMC awards/commendations with civilian-readable framing

### Behavioral Profile
- TODO: Complete 02-behavioral-profile.md (DISC self-assessment — ~30 min)
- **Known strengths:** Systems thinking, quality discipline, building reliable infrastructure, cross-functional coordination, regulated-environment leadership
- **Thrives in:** High-stakes regulated environments, autonomous work with clear accountability, environments that value precision and correctness

### What Excites You
- Building reliable AI systems with real quality gates and measurable correctness
- Applying compliance and governance discipline to AI deployments (the "same muscle" as ACA accreditation)
- GovTech — making government services better through technology
- Autonomous trading and financial systems engineering

### Target Sectors
- **GovTech:** Granicus, Tyler Technologies, Socrata/Tyler, NIC/Tyler, ServiceNow Government, Salesforce Government
- **Defense/Cleared AI:** Palantir, Leidos, SAIC, Booz Allen Hamilton, MITRE, L3Harris, Raytheon
- **Federal/Civilian AI:** AWS Public Sector, Microsoft Federal, Google Federal, IBM Federal
- **Fintech/RegTech:** Veeva, Compliance.ai, Relativity, LogicGate

### Deal-breakers
- In-office roles outside California (no relocation)
- Roles requiring active combat deployment (service is winding down, not pivoting back)
- Pure sales roles with no technical or operational component

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
