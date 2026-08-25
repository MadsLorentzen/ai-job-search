---
framework_version: 1.1.1
---

# Agent Guidelines & Single Source of Truth: Nehul Bhatnagar

> **Single source of truth:** All candidate profile data, evaluation guidelines, and workflow rules live in this file and `.agents/skills/`.

This workspace is optimized for Google Antigravity (`agy`), Codex, and standard Agent Skills. All tools, skills, and application workflows live under `.agents/skills/`.

## Role & Mission
This workspace is an intelligent career advisor, application builder, and job search hub for **Nehul Bhatnagar**. The agent assists with:
1. **Job fit evaluation** - Assess postings against candidate technical & behavioral profile
2. **CV tailoring** - Generate targeted, compile-ready LaTeX CVs (`cv/main_<company>.tex`) using moderncv
3. **Cover letter generation** - Generate targeted, single-page LaTeX cover letters (`cover_letters/cover_<company>_<role>.tex`) using `cover.cls`
4. **Application form fields** - Draft grounded responses for ATS text boxes, short pitches, and competency questions
5. **Interview preparation** - Structure STAR examples, technical drill-downs, questions for the interviewer, and mock interviews
6. **Career strategy & tracking** - Track application lifecycle, sync with Notion/Gmail, generate analytics, and identify skill gaps

---

## Candidate Profile

### Identity
- **Name:** Nehul Bhatnagar
- **Location:** Bengaluru, India
- **Languages:**
  | Language | Level |
  |----------|-------|
  | English | Fluent / Professional |
  | Hindi | Native |
- **CV language:** English
- **Status:** Employed (Machine Learning Engineer - II)
- **LinkedIn headline:** "Machine Learning Engineer - II at Revionics | Goldman Sachs Portfolio"
- **Contact:** +91-8949446740 | nbhatnagar3010@gmail.com | linkedin.com/in/nehulbhatnagar | https://github.com/zerodoxxx

### Education
- **B.Tech in Electronics and Communication Engineering** (2019-2023) - National Institute of Technology, Jalandhar (Jalandhar, India)
  - *Key Topics:* Machine Learning, Signal Processing, Distributed Systems, Data Structures & Algorithms

### Professional Experience
- **Machine Learning Engineer - II** (Nov. 2023 - Present) - **Revionics — portfolio of Goldman Sachs** (Bengaluru, India)
  - *MLE leading production-grade ML/LLM systems, API engineering, and infrastructure for retail optimization*
  - Architected and deployed an enterprise RAG system for internal help documentation and complex client documents using LLM pipelines and Vector DBs, streamlining domain knowledge retrieval and reducing ticket resolution time by 70%+.
  - Led technical design of a multi-agent LLM pricing platform, crafting optimized prompt strategies, evaluations, and workflow execution engines via high-throughput FastAPI services.
  - Reduced cloud compute costs by $100k+ annually and improved latency by >80% by developing and containerizing a high-performance REST API (*CostChangeWizard*) deployed via Docker on Kubernetes.
  - Eliminated 95%+ of manual data linkage efforts by training, fine-tuning, and optimizing inference for a Siamese network (triplet loss) paired with Leiden clustering across enterprise datasets.
  - Generated $2M+ in new European revenue by developing modular, VAT-aware forecasting libraries in Python (*FinanPy*), establishing robust monitoring, logging, and evaluation frameworks.

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
- **Machine Learning & LLMs:** RAG Systems, Multi-Agent Systems, Prompt Engineering, Model Finetuning, Vector Databases (FAISS, Pinecone), Inference Optimization, Embeddings, NLP, Agentic Workflows
- **Backend & Infrastructure:** REST APIs, Docker, Kubernetes (EKS/GKE), Microservices Architecture, CI/CD, Monitoring, Rate Limiting, Logging & Alerting
- **Data & Distributed Systems:** Apache Airflow, Apache Kafka, Databricks, Snowflake, BigQuery, Spark, MSSQL, MongoDB

### Publications
- Co-Author & Core ML Contributor (Feb. 2026). *SocialPulse: An Open-Source Subreddit Sensemaking Toolkit*. ICWSM 2026 / arXiv ([https://arxiv.org/abs/2602.07248](https://arxiv.org/abs/2602.07248)).
  - Published at ICWSM 2026, developing NLP + GenAI modules to extract structured analytics from unstructured community datasets.

### Behavioral Profile
- **Strengths:** Systems thinking, fast execution, cross-functional collaboration, backend and ML performance optimization, architectural clarity
- **Growth areas:** Deep domain-specific financial modeling
- **Thrives in:** High-impact, fast-paced engineering teams building production ML, LLM, and Agentic systems with high ownership
- **Deal-breakers:** Low-agency maintenance roles without production system ownership

### Target Sectors
- AI/ML Startups & Big Tech
- High-frequency trading and FinTech
- Enterprise AI & Agentic systems

---

## Repository Structure
- `cv/` - LaTeX CV variants (`moderncv` template, banking style / classic single column)
- `cover_letters/` - LaTeX cover letters (`cover.cls` template)
- `.agents/skills/` - Discoverable Agent Skills for all job search and application capabilities
  - `job-application-assistant/` - Core evaluation, CV/cover letter templates, interview prep, web research frameworks
  - `apply/` - End-to-end multi-step job application orchestrator
  - `job-scraper/` - Multi-portal job scraper and deduplicator
  - `rank/` - Batch scoring and shortlisting scraped jobs
  - `interview/` - Interview prep pack and mock interview simulator
  - `outcome/` - Application stage tracking and feedback archive
  - `gmail-sync/` - Gmail application update scanner
  - `notion-sync/` - Sync tracker with Notion database
  - `html-report/` - Visual HTML dashboard for job search analytics
  - `upskill/` - Skill gap analysis and prioritized learning plan
  - `setup/`, `expand/`, `reset/`, `add-portal/`, `add-template/` - Management and onboarding tools
- `documents/` - Real career documents, certificates, and application archives (`documents/applications/<company>_<role>/`)
- `company_research/` - Cached company dossiers and research JSONs

---

## Workflow for New Job Applications
1. User provides a job posting (URL or text).
2. **Evaluate Fit First:** Skills match, experience match, behavioral/culture match, salary lookup. Present assessment to the user before drafting.
3. **Draft Targeted Documents:** Create `cv/main_<company>.tex` and `cover_letters/cover_<company>_<role>.tex`.
4. **Compile & Inspect PDFs (MANDATORY):** Compile with `lualatex` (CV) and `xelatex` (cover letter), inspect page count and layout.
5. **Verify ATS parseability & checklists:** Check embedded text layer with `pdftotext`.
6. **Archive Application:** Record entry in `job_search_tracker.csv` and archive in `documents/applications/<company>_<role>/`.

---

## Verification Checklist
After creating or updating a CV or cover letter, verify **all** items:

### Factual Accuracy
- [ ] All claims match actual profile (no fabricated skills, metrics, experience, or achievements)
- [ ] Job titles, dates, company names, and locations are strictly accurate
- [ ] Contact details and URLs are correct

### Targeting & Content
- [ ] Profile statement / opening paragraph tailored to the specific role and company
- [ ] Skills and experience bullets reframed to match job requirements and keywords
- [ ] Mandatory hyperlinks active: arXiv paper (`https://arxiv.org/abs/2602.07248`), email (`mailto:`), LinkedIn, GitHub

### Compiled PDF Verification
- [ ] CV compiled with **lualatex** (`pdflatex` fails on modern MiKTeX/TeX Live with fontawesome5 issues)
- [ ] Cover letter compiled with **xelatex** (`cover.cls` requires fontspec)
- [ ] **CV is exactly 2 pages** (or 1 page for single-page formats) with no orphaned titles (`\needspace{5\baselineskip}`)
- [ ] **Cover letter is exactly 1 page** with body and signature fitting cleanly

### ATS & Text Layer
- [ ] Clean text extraction via `pdftotext -layout -enc UTF-8` (no replacement chars or missing text)
- [ ] Email and phone present as literal text in extraction
