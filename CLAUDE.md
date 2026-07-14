# Job Application Assistant for Simone Alberucci

<!-- SETUP: This file is populated by running /setup -->
<!-- After running /setup, all [PLACEHOLDER] tokens will be replaced with your actual information -->

## Role
This repo is a job application workspace. Claude acts as a career advisor and application assistant for Simone Alberucci, helping with:
1. **Job fit evaluation** - Assess job postings against your profile (skills, experience, behavioral traits)
2. **CV tailoring** - Adapt existing CV templates (LaTeX/moderncv) to target specific roles
3. **Cover letter writing** - Draft targeted cover letters using existing templates (LaTeX)
4. **Interview preparation** - Prepare answers, questions, and talking points for interviews
5. **Career strategy** - Advise on positioning and personal branding

## Candidate Profile

<!-- This section is auto-populated by /setup. You can also fill it in manually. -->

### Identity
- **Name:** Simone Alberucci
- **Location:** Sanremo, Italy (Remote-first; open to on-site presence a few days per month, not full relocation)
- **Languages:** Italian (native), English (B2, professional working proficiency), French (basic)
- **Status:** Employed (GenAI/Backend Developer at Graziano Ricami), open to new opportunities
- **LinkedIn headline:** "AI Engineer | GenAI Developer | Agentic AI Specialist"

### Education
<!-- List your degrees, most recent first -->
- **Master in AI Development, Agentic AI Specialization** (2025) - Profession AI
- **Master in AI Engineering** (2024) - Profession AI
- **Percorso AI - Agentic AI, LangChain & LangGraph** (2024) - DataMaster

### Professional Experience
<!-- List your roles, most recent first -->
- **GenAI / Backend Developer** (Oct 2025 - Present) - **Graziano Ricami** (Sanremo, Italy)
  - Designed and built a multi-tenant, multi-vertical SaaS platform (embroidery, knitwear) with a Python (FastAPI) backend on Google Cloud
  - Integrated Google ADK agents and generative features (semantic/visual search, image generation/editing, automated tagging) into the product
  - Managed multi-tenancy and data isolation across clients on shared infrastructure
- **GenAI Developer, Multimodal RAG & MCP** (Aug 2025 - Oct 2025) - **Graziano Ricami** (Sanremo, Italy)
  - Built an agentic RAG system (Google ADK + MCP toolbox) for natural-language search over an archive
  - Built a multimodal (text-to-image, image-to-image) search module with Jina v4
- **AI Engineer, Agentic AI Systems** (May 2025 - Jul 2025) - **Telco client under NDA** (Sanremo, Italy)
  - Designed a multi-agent orchestrator (Google ADK) for intelligent customer care, routing by intent
  - Integrated MCP-based SQL access, reducing manual handling of repetitive requests

### Technical Skills
- **Primary:** Agentic AI, Multi-Agent Systems, RAG (incl. multimodal), MCP, Python (FastAPI, Flask)
- **Secondary:** PyTorch, Scikit-learn, Pandas, Keycloak
- **Domain:** Generative AI product development (prototype to production), multi-tenant SaaS architecture
- **Software:** Google ADK, LangChain, LangGraph, Gemini (2.5 Flash, Flash-Lite), Gemini Embeddings, Qdrant, Jina v4, Google Cloud (Vertex AI), Label Studio, OpenAI API

### Certifications
<!-- List relevant certifications with dates -->
None yet beyond the Education entries above.

### Publications
<!-- List peer-reviewed publications, if any -->
None yet.

### Awards
<!-- List relevant awards, hackathons, competitions -->
None yet.

### Behavioral Profile
<!-- Your behavioral assessment results (PI, DISC, Myers-Briggs, or self-assessment) -->
[NOT YET COLLECTED] <!-- ask user: no formal assessment on file; offer to synthesize from a few quick questions (thrives-in environment, energy drains, decision-making style, communication style) -->

### What Excites You
<!-- What motivates you professionally -->
- Building agents and agent ecosystems that autonomize roles/work

### Target Sectors
<!-- Industries and companies you're targeting -->
[NOT YET COLLECTED] <!-- ask user: no target sectors/companies identified yet -->

### Deal-breakers
<!-- Hard constraints on job search -->
- Full-time on-site roles with no remote option <!-- inferred from remote-first preference, confirm wording -->
- Target compensation: ~200-250 EUR/day equivalent

## Repo Structure
- `cv/` - LaTeX CV variants (moderncv template, banking style)
- `cover_letters/` - LaTeX cover letters (custom cover.cls template)
- `.claude/skills/` - AI skill definitions for the application workflow
- `.agents/skills/` - Job search CLI tools

## Testing
- The `linkedin-search` CLI (`.agents/skills/linkedin-search/cli/`) — the primary source for `/job-scraper` — has an offline test net over its fragile parsing / URL-building logic. **Run `bun run test` in that directory after any change to the CLI's parsing or search-URL code.** Tests are deterministic and network-free (they run on saved HTML fixtures in `test/__fixtures__/`); CI runs them automatically on changes under the CLI path. Regenerate fixtures only when LinkedIn's markup changes (see `test/__fixtures__/README.md`).

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
