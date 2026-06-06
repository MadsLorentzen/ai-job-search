# Job Evaluation Framework

<!-- SETUP: Skill match areas and career goals are personalized by running /setup -->

## Scoring Dimensions

Evaluate each job posting against these five dimensions:

### 1. Technical Skills Match (0-100)
How well do the required/preferred skills align with the candidate's capabilities?

| Score | Meaning |
|-------|---------|
| 80-100 | Core requirements are primary skills |
| 60-79 | Most requirements match, 1-2 gaps that are learnable |
| 40-59 | Partial match, significant upskilling needed |
| 0-39 | Fundamental mismatch |

**Strong match areas:** Data Engineering (Python, PySpark, Apache Airflow, AWS, GCP), Backend Software Engineering (Python, GCP, event-driven architecture), Analytics Engineering (SQL, Superset, dashboards), ETL/pipeline architecture

**Moderate match areas:** ML Engineering (PyTorch, Keras, TensorFlow, Sklearn — academic + applied customer modeling), Data Science (e-commerce analytics, customer segmentation)

**Weak match areas:** Pure ML research / ML scientist roles (limited publication record), full-stack frontend engineering, infrastructure/DevOps-primary roles

### 2. Experience Match (0-100)
Does work history align with what they're looking for?

| Score | Meaning |
|-------|---------|
| 80-100 | Direct experience in the same domain and role type |
| 60-79 | Related experience, transferable skills clear |
| 40-59 | Adjacent experience, would need to make the case |
| 0-39 | Unrelated experience |

**Strong:** Data engineering (pipelines, Airflow, PySpark, AWS, GCP), backend software engineering (Python, event-driven systems, GCP), analytics engineering (reporting automation, SQL, dashboards, stakeholder delivery)

**Moderate:** ML engineering (academic MSc thesis + applied customer modeling at mytheresa), data science (segmentation, conversion modeling), software engineering (Ruby on Rails background)

**Entry-level / stretch:** Pure research roles, DevOps/infrastructure-primary roles, product management

### 3. Behavioral/Culture Fit (0-100)
Does the role and company culture match the behavioral profile?

| Score | Meaning |
|-------|---------|
| 80-100 | Culture strongly matches behavioral preferences |
| 60-79 | Mixed signals but mostly compatible |
| 40-59 | Some friction areas |
| 0-39 | Significant culture mismatch |

**Red flags to research:** Department disorganization, work dominated by maintenance over development, poor chemistry with leadership, culture mismatches. Check reviews, media coverage, LinkedIn connections, and network contacts for insider perspective.

### 4. Location & Logistics (Pass/Fail + Notes)
- Within commute range: PASS
- Remote with occasional office: PASS
- Requires relocation: FAIL (deal-breaker)
- Frequent international travel: FLAG (discuss with user)

### 5. Career Alignment & Motivation (0-100)
Does this role advance career goals and contain tasks that energize?

| Score | Meaning |
|-------|---------|
| 80-100 | Strongly aligned with career direction, clear growth path |
| 60-79 | Good role but only partially aligned with long-term goals |
| 40-59 | Decent job but doesn't build toward career goals |
| 0-39 | Dead end or backwards step |

**Career goals:**
- [Not yet collected — run /setup --section career to update]

**Motivation filter:** Evaluate not just whether you *can* do the tasks, but whether the tasks will *energize* you. Consider:
- Tasks that energize: hard engineering problems with real-world impact; building systems that scale; ownership of end-to-end work; knowledge sharing and mentoring; working in or near health tech / science domains
- Tasks that drain: pure maintenance without development component; ambiguous ownership; roles that don't grow toward more senior scope
- Non-task factors: leadership style, department culture, company values, degree of autonomy

**Life situation alignment:** Consider personal constraints:
- **Security**: Currently employed; salary baseline ≥€70k (inferred from LinkedIn About filter)
- **Flexibility**: Berlin-based; applying to Berlin roles; no relocation
- **Professional development**: [Not yet collected]

## Calibration from Past Applications

### Confirmed strong-fit signals (reached interview or offer)
- **Data Engineer** roles: 2 hires (Veeva Systems Apr 2024; Aignostics as Software Engineer in Data Onboarding Dec 2024), multiple phone screens (KoRo, Omio, Delivery Hero via referral), full interview loop (Flatiron Health, multiple days)
- **Analytics Engineer** roles: offer received at AVIV Group (Product Analyst, declined); suggests strong enough signal to reach final stage in analytics-adjacent roles
- **Backend Software Engineer** roles: hired at Aignostics (Feb 2025)

### Patterns to flag
- Pure ML Scientist roles (e.g., Bayer): fast rejection without interview — publication-heavy research roles are likely a stretch
- Top-tier "Senior" roles at FAANG/near-FAANG (Airbnb, Netflix, Google, Databricks): no response — level mismatch or competition density
- Product Analyst role type (AVIV Group): offer declined by candidate — role type likely not energizing despite technical capability
- Project A Data Engineer: withdrew after first call with Head of Data and Director Data — screens for management/culture fit

### 6. Salary Benchmark (Optional)

If the salary lookup tool is configured (`salary_data.json` exists), look up the company:
```
python salary_lookup.py "<Company Name>" --json
```

If a city is known from the posting, add `--city "<City>"` to narrow results.

Present findings as:
```
### Salary Benchmark
| Metric | Value |
|--------|-------|
| [Category] index | XX.X (+/-X.X% vs baseline) |
| Overall index | XX.X (+/-X.X% vs baseline) |
```

Interpret results relative to the baseline defined in the data file's metadata. For index-based data, higher typically means above-market compensation.

If the salary tool is not configured, skip this section.

## Output Format

Present the evaluation as:

```
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
- [ ] Checked review sites (Glassdoor, Jobindex, etc.)
- [ ] Checked LinkedIn for team size, recent hires, connections
- [ ] Checked media for restructuring, growth, or workplace issues
- [ ] Identified network contacts who may know the team/manager
```

## Weighting
- Technical Skills: 30%
- Experience Match: 25%
- Behavioral Fit: 15%
- Career Alignment: 30%

(Location is pass/fail, not weighted)

## Thresholds
- **Strong Fit** (75+): Definitely apply, tailor everything
- **Good Fit** (60-74): Apply, address gaps in cover letter
- **Moderate Fit** (45-59): Consider carefully, discuss with user
- **Weak Fit** (30-44): Probably skip unless strategic reasons
- **Poor Fit** (<30): Skip

## Pre-Application: Call the Employer (Best Practice)

Before writing the application, consider whether the candidate should call the contact person listed in the posting. **Only call if there are substantive questions** - never call just to "be remembered."

### When to Suggest Calling
- The posting has unclear or ambiguous requirements
- It's unclear which competencies are essential vs. nice-to-have
- The role description is vague about day-to-day tasks
- There's a named contact person who invites questions

### Good Questions to Ask
- "What are the primary challenges in this role?"
- "How is time typically divided across the listed responsibilities?"
- "Which competencies are most critical for success in this position?"
- "What does success look like in the first 6-12 months?"

### Rules for the Call
- Prepare a 30-second "elevator pitch" about your background in case they ask
- The call's purpose is **gathering information**, not delivering a pitch
- Take notes - use what you learn to tailor the application
- Reference the conversation naturally in the cover letter ("After speaking with [name], I was especially drawn to...")
