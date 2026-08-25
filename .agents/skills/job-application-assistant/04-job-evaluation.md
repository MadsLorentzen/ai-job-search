---
framework_version: 1.2.6
---

# Job Evaluation Framework

## Eligibility Gate — run before scoring

If the candidate is not a citizen or permanent resident of the country they are applying in, run this first. It is a hard filter, not a scoring dimension.

Read the posting's eligibility / work rights / "who can apply" section **verbatim** and classify:

| Posting wording | Verdict |
|-----------------|---------|
| Names a **citizenship or permanent-residency requirement** ("must be a citizen of X", "permanent resident", "PR required", "full working rights" where the employer means citizen/PR) | **FAIL — hard stop.** Do not score, do not draft. Quote the exact wording back to the user. |
| Requires a **security clearance** at any level | **FAIL** in most countries, since clearance is normally gated on citizenship. |
| **Explicitly names** the candidate's permit class, or says "international applicants welcome", "visa holders considered", "we sponsor" | **PASS** — verified acceptance. |
| **Silent** on citizenship or residency | **PROCEED, but mark unverified.** Check the employer's own careers or international-applicant page before drafting. |

A role that fails this gate is not scored and not drafted.

## Language Gate — run before scoring

Compare required role language against the candidate's Languages table in `AGENTS.md` / `01-candidate-profile.md`:

| Posting requirement vs. Languages table | Verdict |
|---|---|
| Requires a language **not on candidate table at all** (e.g. "fluent German required") | **FAIL — hard stop.** Do not score, do not draft. |
| Requires a language candidate lists, but stated bar reads as plausibly **higher** than declared level | **FLAG, then proceed.** Score and draft normally, but surface the gap explicitly. |
| Requires a declared language at or below declared level (e.g. English) | **PASS.** No note needed. |

## Scoring Dimensions

Evaluate each job posting against these five dimensions:

### 1. Technical Skills Match (0-100)
How well do the required/preferred skills align with the candidate's capabilities?

| Score | Meaning |
|-------|---------|
| 80-100 | Core requirements are primary skills (Python, PyTorch, RAG, LLM Systems, FastAPI, Docker, K8s, Airflow, Kafka) |
| 60-79 | Most requirements match, 1-2 gaps that are easily learnable |
| 40-59 | Partial match, significant upskilling needed |
| 0-39 | Fundamental mismatch |

### 2. Experience Match (0-100)
Does work history align with the target role?

| Score | Meaning |
|-------|---------|
| 80-100 | Direct experience in production ML/LLM systems, backend microservices, or distributed data pipelines |
| 60-79 | Related software/data engineering experience, transferable skills clear |
| 40-59 | Adjacent experience, would need to make the case |
| 0-39 | Unrelated experience |

### 3. Behavioral/Culture Fit (0-100)
Does the role and company culture match the behavioral profile?

| Score | Meaning |
|-------|---------|
| 80-100 | High ownership, fast-paced development, engineering-led culture |
| 60-79 | Mixed signals but mostly compatible |
| 40-59 | Some friction areas (e.g. heavy maintenance over new builds) |
| 0-39 | Significant culture mismatch |

### 4. Location & Logistics (Pass/Fail + Notes)
- Bengaluru (onsite/hybrid): PASS
- Remote (global/India): PASS
- Requires unassisted relocation: FLAG / discuss

### 5. Career Alignment & Motivation (0-100)
Does this role advance career goals toward Staff/Senior MLE, production AI systems, and high-impact infrastructure?

| Score | Meaning |
|-------|---------|
| 80-100 | Strongly aligned, production LLM/agentic ownership or high-scale distributed backend |
| 60-79 | Good role but only partially aligned with long-term goals |
| 40-59 | Decent job but doesn't build toward career goals |
| 0-39 | Dead end or backwards step |

### 6. Salary Benchmark (Optional)

If the salary lookup tool is configured (`salary_data.json` exists), look up the company:
```bash
python salary_lookup.py "<Company Name>" --json
```

If a city is known from the posting, add `--city "<City>"` to narrow results.

## Output Format

```markdown
## Job Fit Evaluation: [Role] at [Company]

| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | XX/100 | [brief note] |
| Experience Match | XX/100 | [brief note] |
| Behavioral Fit | XX/100 | [brief note] |
| Location | PASS/FAIL | [brief note] |
| Career Alignment | XX/100 | [brief note] |

**Overall Score: XX/100** (weighted average of scored dimensions)

### Verdict: [Strong Fit / Good Fit / Moderate Fit / Weak Fit / Poor Fit]

### Key Strengths for This Role
- [bullet points]

### Gaps to Address
- [bullet points]

### Recommendation
[1-2 sentences: apply/skip/apply with caveats]

### Company Research Checklist
- [ ] Checked company website (mission, values, recent news)
- [ ] Checked review sites (Glassdoor, AmbitionBox, etc.)
- [ ] Checked LinkedIn for team size, recent hires, connections
- [ ] Checked media for restructuring, growth, or workplace issues
- [ ] Identified network contacts who may know the team/manager
```

## Company Research Cache

The Company Research Checklist above is executed by `/apply` Step 3's reviewer agent and by `/interview` Step 2. This cache lets consumers reuse recent results instead of repeating search/fetch.

**File:** `company_research/<normalized-company-name>.json` (e.g. `company_research/revionics.json`).

**TTL:** 30 days from `fetched_date`.

**Schema:**
```json
{
  "company": "Company Name",
  "fetched_date": "YYYY-MM-DD",
  "sources": {
    "website": {"url": "...", "notes": "..."},
    "reviews": {"url": "...", "notes": "..."},
    "linkedin": {"url": "...", "notes": "..."},
    "media": {"url": "...", "notes": "..."}
  },
  "network_contacts_note": "..."
}
```

## Weighting
- Technical Skills: 30%
- Experience Match: 25%
- Behavioral Fit: 15%
- Career Alignment: 30%

## Thresholds
- **Strong Fit** (75+): Definitely apply, tailor everything
- **Good Fit** (60-74): Apply, address gaps in cover letter
- **Moderate Fit** (45-59): Consider carefully, discuss with user
- **Weak Fit** (30-44): Probably skip unless strategic reasons
- **Poor Fit** (<30): Skip
