# /learn-project - Turn job requirements into portfolio learning projects

Use when the user wants to learn missing skills through GitHub projects.
Read `.claude/skills/job-application-assistant/10-remote-brazil.md` and the private
candidate profile first. This command prepares learning work, never applies to jobs.

## Inputs

Accept a posting URL, pasted posting, or an existing application archive. With no
argument use local documents/applications/ and ranked job records as leads; load
full posting text before asserting requirements. Read prior upskill reports as leads,
not proof. If no postings exist, label suggested labs provisional and request one to
three target job links. Never infer employer requirements from job titles alone.

## Diagnose

For each requirement, retain the posting URL, date, short excerpt, required/preferred
status, and relevant profile evidence. Distinguish demonstrated skill, learning gap,
portfolio-evidence gap, and unknown experience. A resume omission alone is unknown;
a tool mention alone does not demonstrate advanced proficiency. Ask whether the user
already has the skill before prescribing fundamentals. Do not turn visa/residency,
years of employment or certificates into gaps a weekend project supposedly closes.

Prioritize repeated required gaps across eligible Brazil/USD roles, then effort and
transferability. A job appears only once. Report coverage as N of M inspected postings,
not as a market-wide statistic. Start one project at a time, default 6-8 hours/week;
let the user change the time budget. Prefer extending an existing suitable portfolio
repository after inspecting it, rather than generating redundant beginner projects.

## Design a project

Each brief includes problem, 1-3 target skills, prerequisites already demonstrated,
source-backed gap table, local/public/synthetic data, 3-5 milestones, estimated effort,
acceptance checks, failure cases, demo instructions and interview questions.
Choose automotive/industrial examples when useful without using employer-owned data.
Use portfolio-labs/ as candidate designs, not evidence of a user's deficiency.
Search official documentation for selected tools and record links. Estimates are
planning budgets, not promises of mastery. A no-cost/local baseline comes first;
cloud spending requires the user's explicit choice.

## Learning loop

For each milestone ask for the user's short design or attempt, give a bounded scaffold
and a failing behavioral check, then review their implementation and explanation.
Offer hints before complete solutions unless explicitly asked for one. Mark progress
planned -> in_progress -> demonstrated, with commit, test output and a short explanation
of tradeoffs. Scaffold generation is not evidence of learned skill. A project completion
must not silently add professional experience or inflated metrics to the resume.

## Promote reviewed learning to application evidence

When creating or extending a GitHub learning project, include a short side note in
the progress report with its link, current milestone and what the user can learn.
Keep it out of resumes and application fields until the user has reviewed the work
and confirmed they have learned it. Generated code, passing tests and publication
alone do not satisfy this condition.

After that review and learning confirmation, record the date, reviewed commit,
demonstrated skills, the user's contribution and any remaining limitations in the
private candidate profile. Relevant evidence may then be used in tailored resumes
and application answers without repeatedly asking for permission to reuse it.
Describe it as a personal learning or portfolio project, accurately distinguish
AI-assisted work from the user's own contribution, and use only verified results.
Never convert it into employment tenure, production deployment or unearned mastery.
Materially new claims from later project changes need new supporting review evidence.

## Save and GitHub

At milestone reviews, follow
`.claude/skills/job-application-assistant/12-portfolio-writing.md` to consider a
Medium article about the work and save a concrete writing step in the private backlog.

Create each personal side project in its own standalone repository and sibling
working directory, outside this job-search framework fork. Keep `portfolio-labs/`
for reusable project briefs and links only; do not place project implementations,
runtime environments, or generated datasets here. Extend an existing suitable
standalone project rather than creating a repository for every individual tool.

Save job-specific gap analysis and feedback locally under ignored upskill/report-*.md.
Public project files contain the learning specification, synthetic/public data recipe,
code, tests and measured results only; omit application history and personal weaknesses.
If the user requests GitHub publication and supplies a writable repo, commit the scoped
project files there. A connected GitHub account is sufficient; never ask for a token
in chat. If creating a new repository is unavailable, prepare the files and request
an empty repository link. Do not create GitHub Projects boards or message recruiters
unless separately requested. Before publishing verify no private input or employer
material is included. Preserve licenses when reusing code.
