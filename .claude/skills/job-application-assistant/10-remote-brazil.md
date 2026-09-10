# Remote Brazil / USD search policy

This is the canonical market policy for this fork. Read before /setup, /scrape,
/rank, /apply, direct application drafting, and /upskill. User instructions can
change these defaults; never silently relax them to fill a results quota.

## Target

- AI Engineer, Machine Learning Engineer, Data Scientist, Data Engineer; include
  Analytics Engineer when the work meaningfully overlaps data engineering.
- Mid-level and senior individual-contributor roles. Judge responsibilities, not
  the candidate's current job title. Staff/lead is a stretch, never inferred tenure.
- Fully remote while living in Brazil; Brazil, LATAM, or explicitly worldwide hiring.
- USD payment and at least USD 4,500 gross base per month (USD 54,000/year over 12 months).
  These are search thresholds, not an instruction to quote the minimum as salary expectations.
- International contractor or employer/EOR arrangement that supports Brazil.
- Automotive, mobility, telematics, EV/battery, industrial ML and engineering tools
  receive a domain preference; do not exclude good cross-industry roles.
- English application materials by default. Actual language proficiency, notice
  period, employment/degree dates and work authorization must come from the local profile.

## Gates, before fit scores

Evaluate remote arrangement, Brazil eligibility, payment currency, compensation,
required working-hour overlap, and role fit independently. Use PASS / FLAG / FAIL.
Store source URL, exact supporting excerpt and checked date for each factual gate.

FAIL: mandatory office attendance or relocation, explicit Brazil exclusion,
residency-only restriction incompatible with living in Brazil, non-USD payment,
confirmed incompatible working-hour overlap or contract arrangement,
or a confirmed salary maximum below the threshold.

FLAG: 'remote' with no country scope, unknown payment currency, unpublished salary,
range straddling the floor, salary estimate, unknown overlap/contract arrangement,
or unspecified citizenship/visa requirement applicability.

PASS only where evidence supports the condition. Worldwide/Latin America statements
must cover the specific role and not contain a Brazil exclusion. Employer-specific
US work authorization is not automatically required of a Brazil-based contractor;
never invent authorization or assume an EOR arrangement exists.

Display two lists: confirmed matches and promising roles needing clarification.
Keep unknown-salary roles out of the confirmed list. A sourced estimate >= the floor
may appear in the second list, clearly labeled with source, date and uncertainty.
Do not invent salary estimates, guarantee an offer inside a posted range, count
bonuses/equity as base salary, or treat USD display conversion as USD payment.
Annual base / 12 is a comparison convention. Hourly rates need explicitly supplied
paid hours/month; show the assumption. No default 160-hour or 40-hour assumption.

For repeatable salary/eligibility classification, write the reviewed posting fields
to ignored reports/<job>-eligibility.json and run:
`python tools/remote_gate.py reports/<job>-eligibility.json`.
The schema/example is config/remote-job.example.json. This helper does not extract
facts or override the user's profile; the agent supplies source-grounded fields.
Record its verdict and reasons in the job's fit notes without changing tracker schema.
Review `overlap_compatible` and `contract_compatible` explicitly with supporting
excerpts: missing values remain FLAG and false values are FAIL. Recheck older
eligibility records rather than guessing these values during migration.
A FAIL vetoes recommendation/drafting unless the user explicitly changes that criterion.
A FLAG remains visible; ask only the missing question that affects the next action.

## Tailoring and evidence

Choose one emphasis per role: AI (LLM systems, evaluation, deployment), DS (modeling,
validation, experiments, impact), DE (pipelines, SQL, orchestration, reliability).
These are selection categories, not claims about the candidate. Select verified
projects from local career documents. Preserve exact titles, dates, metrics and
personal ownership. Do not call unfinished research a deployed or published product.
Use the employer's terms only where the underlying experience supports them.

LinkedIn export, master CV, reference letters, project notes and portfolio links
belong in the private workspace described in docs/REMOTE_SETUP.md. For each added
fact record source and verification date in the candidate profile. Resolve conflicting
dates and achievements with the user. A repository dependency or course syllabus is
only a skill signal, not proof of personal proficiency. /expand must distinguish
observed evidence from inferred competencies and get confirmation before promotion.

For portal questions, use 08-application-forms.md. Save question, tailored answer,
word/character count, supporting profile source and unresolved details in the local
application archive. Do not invent responses to eligibility, salary, consent or
availability questions. Do not attach reference contact details without authorization.

## Execution

For session recovery, confirmed-fact updates, authorized batches, and submission
evidence, follow `11-application-operations.md`.

Runs on the home desktop through the configured agent runtime; no cloud deployment or always-on
service is needed. The model provider may receive the career text supplied to it.
/apply prepares materials; it does not automatically submit forms. Submission,
recruiter messages, assessments and account creation need explicit user instructions.
Keep upstream review and PDF verification. Do not repeatedly ask to begin drafting
when the user's current request already explicitly authorizes that exact drafting.

Danish demo portals remain disabled. LinkedIn automated scraping is disabled;
use user-provided postings or permitted public search. Wellfound is a discovery/manual
handoff source, not an unattended scraper. Never bypass logins or CAPTCHA. Public
ATS discovery endpoints do not authorize employer-authenticated submission APIs.
