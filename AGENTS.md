# Job Application Assistant for Nehul Bhatnagar

<!-- SETUP: Candidate Profile populated from Nehul_Resume_MLE.pdf -->

> **Single source of truth:** This file is the single source of truth for the candidate profile and job-application workflow rules. `CLAUDE.md` points here, and the skill/command mirrors under `.claude/skills|commands` and `.agents/skills` both operate on it.

## Role
This repo is a job application workspace. The AI assistant acts as a career advisor and application assistant for Nehul Bhatnagar, helping with:
1. **Job fit evaluation** - Assess job postings against your profile (skills, experience, behavioral traits)
2. **CV tailoring** - Adapt existing CV templates to target specific roles
3. **Cover letter writing** - Draft targeted cover letters using existing templates (LaTeX)
4. **Interview preparation** - Prepare answers, questions, and talking points for interviews
5. **Career strategy** - Advise on positioning and personal branding

## Candidate Profile

### Identity
- **Name:** Nehul Bhatnagar
- **Location:** Bengaluru, India
- **Languages:** English, Hindi
- **Status:** Employed (Machine Learning Engineer - II)
- **LinkedIn headline:** "Machine Learning Engineer - II at Revionics | Goldman Sachs Portfolio"
- **Contact:** +91-8949446740 | nbhatnagar3010@gmail.com | linkedin.com/in/nehulbhatnagar

### Education
- **B.Tech in Electronics and Communication Engineering** (2019-2023) - National Institute of Technology, Jalandhar (Jalandhar, India)

### Professional Experience
- **Machine Learning Engineer - II** (Nov. 2023 - Present) - **Revionics — portfolio of Goldman Sachs** (Bengaluru, India)
  - *MLE leading production-grade ML/LLM systems, API engineering, and infrastructure for retail optimization*
  - Architected and deployed an enterprise RAG system for internal help documentation and complex client documents using LLM pipelines and Vector DBs, streamlining domain knowledge retrieval and reducing ticket resolution time by 70%+.
  - Led technical design of a multi-agent LLM pricing platform, crafting optimized prompt strategies, evaluations, and workflow execution engines via high-throughput FastAPI services.
  - Reduced cloud compute costs by $100k+ annually and improved latency by >80% by developing and containerizing a high-performance REST API (CostChangeWizard) deployed via Docker on Kubernetes.
  - Eliminated 95%+ of manual data linkage efforts by training, fine-tuning, and optimizing inference for a Siamese network (triplet loss) paired with Leiden clustering across enterprise datasets.
  - Generated $2M+ in new European revenue by developing modular, VAT-aware forecasting libraries in Python (FinanPy), establishing robust monitoring, logging, and evaluation frameworks.
- **Machine Learning Engineering Intern** (May 2023 - Aug. 2023) - **Coinbase** (India)
  - *Built LLM-powered social intelligence systems and scalable data ingestion pipelines*
  - Designed and deployed an end-to-end Social Intelligence pipeline utilizing LLM-powered NLP to extract crypto market signals from high-volume social media streams in near real-time.
  - Engineered fault-tolerant automated data pipelines using Apache Airflow to ingest and process 15K+ tweets/hour for downstream model inference.
  - Implemented narrative detection pipelines combining BERTopic and LLM vector embeddings, optimizing topic clustering accuracy on unstructured context.
- **Summer Analyst (SWE Intern)** (Jun. 2022 - Jul. 2022) - **Goldman Sachs** (Bengaluru, India)
  - *Engineered high-throughput distributed pipelines and optimized microservices processing trade data*
  - Accelerated Apache Kafka processing by 700% (from 14 hours to <120 mins) by architecting a scalable multiprocessing pipeline handling 6M+ messages (60GB+) per run.
  - Unified 6 globally fragmented regression environments into a single pipeline, improving API consistency and adopted across 6 international engineering teams.

### Technical Skills
- **Languages & Frameworks:** Python (Expert), SQL, C++, FastAPI, Flask, PyTorch, TensorFlow, Scikit-learn
- **Machine Learning & LLMs:** RAG Systems, Multi-Agent Systems, Prompt Engineering, Model Finetuning, Vector Databases (FAISS, Pinecone), Inference Optimization, Embeddings, NLP
- **Backend & Infrastructure:** REST APIs, Docker, Kubernetes (EKS/GKE), Microservices Architecture, CI/CD, Monitoring, Rate Limiting, Logging & Alerting
- **Data & Distributed Systems:** Apache Airflow, Apache Kafka, Databricks, Snowflake, BigQuery, Spark, MSSQL, MongoDB

### Publications
- Co-Author & Core ML Contributor (Feb. 2026). *SocialPulse: An Open-Source Subreddit Sensemaking Toolkit*. ICWSM 2026 / arXiv ([https://arxiv.org/abs/2602.07248](https://arxiv.org/abs/2602.07248)).
  - Published at ICWSM 2026, developing NLP + GenAI modules to extract structured analytics from unstructured community datasets.

### Awards
<!-- List relevant awards, hackathons, competitions -->
- [AWARD_NAME] - [EVENT] ([YEAR])

### Behavioral Profile
<!-- Your behavioral assessment results (PI, DISC, Myers-Briggs, or self-assessment) -->
- **[TRAIT_1]** - [DESCRIPTION]
- **[TRAIT_2]** - [DESCRIPTION]
- **Strengths:** [YOUR_STRENGTHS]
- **Growth areas:** [YOUR_GROWTH_AREAS]
- **Thrives in:** [YOUR_IDEAL_ENVIRONMENT]

### What Excites You
<!-- What motivates you professionally -->
- [PASSION_1]
- [PASSION_2]

### Target Sectors
<!-- Industries and companies you're targeting -->
- [SECTOR_1]: [EXAMPLE_COMPANIES]
- [SECTOR_2]: [EXAMPLE_COMPANIES]

### Deal-breakers
<!-- Hard constraints on job search -->
- [DEALBREAKER_1]
- [DEALBREAKER_2]

## Repo Structure
- `cv/` - LaTeX CV variants (single-column classic style, moderncv template)
- `cover_letters/` - LaTeX cover letters (custom cover.cls template)
- `.agents/skills/` - Antigravity skills suite (`setup`, `apply`, `add-portal`, `add-template`, `expand`, `reset`, `job-application-assistant`, `job-scraper`, `linkedin-search`, `upskill`)
- `.claude/skills/` - Claude Code skill definitions mirror
- `.agents/agents/reviewer/` - Antigravity reviewer agent definition

## Workflow for New Job Applications
1. User provides a job posting (URL or text)
2. **Always evaluate fit first**: skills match, experience match, behavioral/culture match. Present this assessment to the user before proceeding.
3. If good fit: create targeted CV (`cv/main_<company>.tex`) and cover letter (`cover_letters/cover_<company>_<role>.tex`)
4. **Verify both documents** (see Verification Checklist below)
5. Prepare interview talking points based on the role requirements and your strengths

**Important:**
- When mentioning agentic coding or AI tooling in CVs/cover letters, explicitly name the AI coding tool(s) actually used by the candidate when drafting applications (e.g., Claude Code).
- **Mandatory Hyperlinks:** Always ensure CVs contain clickable hyperlinks using `\href{...}{\underline{...}}` for research papers (e.g. arXiv URL `https://arxiv.org/abs/2602.07248`), email (`mailto:...`), LinkedIn, and project repositories.

## Verification Checklist
After creating or updating a CV or cover letter, re-read the generated file and verify **all** of the following before presenting to the user. Report the results as a pass/fail checklist.

### Factual accuracy
- [ ] All claims match actual profile (AGENTS.md / candidate profile) - no fabricated skills, experience, or achievements
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
- [ ] Agentic coding / AI tooling references explicitly name the AI coding tool(s) actually used by the candidate when drafting applications (e.g., Claude Code)
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
