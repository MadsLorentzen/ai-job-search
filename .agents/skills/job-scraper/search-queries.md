# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Search Sites

Primary:
- **linkedin.com/jobs** - main source for Portugal, EU, and remote roles
- **Company career pages** - direct applications for target companies
- **landing.jobs** - Portugal-friendly tech jobs
- **itjobs.pt** - Portuguese tech roles
- **wellfound.com/jobs** - startups and remote roles
- **welcometothejungle.com** - European tech and product roles
- **otta.com** - tech roles, often remote-friendly
- **indeed.com / glassdoor.com** - broad fallback coverage
- **net-empregos.com** - Portugal general job market fallback

Secondary:
- Google/Bing searches with `site:` filters for target companies
- Remote boards when the profile allows remote EU/global work

## Query Categories

Combine queries with location terms such as `Portugal`, `Lisbon`, `Porto`, `Braga`, `Coimbra`, `remote Portugal`, `remote EU`, or `Europe remote`.

### Priority 1: [YOUR_PRIMARY_ROLE_TYPE]

These match your strongest and most desired career direction.

```text
site:linkedin.com/jobs "[YOUR_PRIMARY_JOB_TITLE]" Portugal
site:linkedin.com/jobs "[YOUR_PRIMARY_JOB_TITLE]" "remote" "Europe"
site:landing.jobs "[YOUR_PRIMARY_JOB_TITLE]" Portugal
site:itjobs.pt "[YOUR_PRIMARY_JOB_TITLE]" [YOUR_CITY]
"[YOUR_PRIMARY_JOB_TITLE]" "[YOUR_KEY_SKILL]" "Portugal" "apply"
```

### Priority 2: [YOUR_DOMAIN_EXPERTISE]

These match your domain expertise.

```text
site:linkedin.com/jobs [YOUR_DOMAIN_KEYWORD_1] [YOUR_CITY] Portugal
site:welcometothejungle.com [YOUR_DOMAIN_KEYWORD_1] Portugal
site:wellfound.com/jobs [YOUR_DOMAIN_KEYWORD_1] remote Europe
"[YOUR_DOMAIN_KEYWORD_2]" "[YOUR_KEY_SKILL]" "Portugal" careers
```

### Priority 3: [YOUR_ADJACENT_ROLE_TYPE]

Adjacent roles you could pivot into.

```text
site:linkedin.com/jobs "[YOUR_ADJACENT_TITLE_1]" "[YOUR_KEY_SKILL]" Portugal
site:linkedin.com/jobs "[YOUR_ADJACENT_TITLE_2]" remote Europe
site:otta.com "[YOUR_ADJACENT_TITLE_1]" remote
"[YOUR_ADJACENT_TITLE_2]" "[YOUR_DOMAIN]" "Portugal" job
```

### Priority 4: Broader Technical / Consulting

Wider net for general technical, consulting, and startup roles.

```text
site:linkedin.com/jobs "[YOUR_KEY_SKILL]" developer Portugal
site:landing.jobs "[YOUR_KEY_SKILL]" remote
site:itjobs.pt "[YOUR_KEY_SKILL]" Portugal
"technical consultant" "[YOUR_DOMAIN]" Portugal
"solutions engineer" "[YOUR_KEY_SKILL]" remote Europe
```

### Priority 5: Target Companies

Use when the profile has target companies or sectors.

```text
site:[TARGET_COMPANY_DOMAIN] careers "[YOUR_PRIMARY_JOB_TITLE]"
site:[TARGET_COMPANY_DOMAIN] jobs "[YOUR_KEY_SKILL]"
"[TARGET_COMPANY]" "[YOUR_PRIMARY_JOB_TITLE]" Portugal
"[TARGET_COMPANY]" careers remote Europe
```

## Location Filter

When evaluating results, verify the job location matches the user's constraints:
- Portugal remote
- Lisbon / Porto / [YOUR_CITY] hybrid
- EU remote with Portugal employment allowed
- Europe remote with contractor arrangement acceptable
- Too far or relocation-only roles should be skipped unless the user explicitly wants them

## Compensation Filter

Prefer postings that list compensation in EUR or have enough public data to estimate a EUR range. Flag missing salary information instead of guessing.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and generate 2-3 custom searches for that focus.
