# Search Queries for Job Scraper

## Search Sites

Primary (job market):
- **computrabajo.com.co** - Computrabajo Colombia
- **elempleo.com/co** - Elempleo Colombia
- **linkedin.com/jobs** - LinkedIn job listings (filter by your location)

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Each query should be combined with location terms where the site supports it.

### Priority 1: Target Role (aligned with career direction)

These queries search for roles directly aligned with your career direction.

```
site:computrabajo.com.co "[YOUR_TARGET_ROLE_1]" [YOUR_CITY]
site:computrabajo.com.co "[YOUR_TARGET_ROLE_2]" [YOUR_CITY]
site:elempleo.com/co "[YOUR_TARGET_ROLE_1]" [YOUR_CITY]
site:elempleo.com/co "[YOUR_TARGET_ROLE_2]" [YOUR_CITY]
site:linkedin.com/jobs "[YOUR_TARGET_ROLE_1]" [YOUR_CITY] [YOUR_COUNTRY]
site:linkedin.com/jobs "[YOUR_TARGET_ROLE_2]" [YOUR_CITY] [YOUR_COUNTRY]
```

### Priority 2: Related Roles

Roles where your current experience is an advantage.

```
site:computrabajo.com.co "[RELATED_ROLE_1]" [YOUR_CITY]
site:computrabajo.com.co "[RELATED_ROLE_2]" [YOUR_CITY]
site:elempleo.com/co "[RELATED_ROLE_1]" [YOUR_CITY]
site:elempleo.com/co "[RELATED_ROLE_2]" [YOUR_CITY]
site:linkedin.com/jobs "[RELATED_ROLE_1]" [YOUR_CITY] [YOUR_COUNTRY]
```

### Priority 3: Broader Technical Roles

Wider net for related technical roles.

```
site:computrabajo.com.co "[BROAD_ROLE_1]" [YOUR_CITY]
site:computrabajo.com.co "[BROAD_ROLE_2]" [YOUR_CITY]
site:elempleo.com/co "[BROAD_ROLE_1]" [YOUR_CITY]
site:linkedin.com/jobs "[BROAD_ROLE_1]" [YOUR_CITY] [YOUR_COUNTRY]
site:linkedin.com/jobs "[BROAD_ROLE_2]" [YOUR_CITY] [YOUR_COUNTRY]
```

## Location Filter

Define your work arrangement preferences:
- **Ideal**: [Your preferred arrangement]
- **Acceptable**: [What you're willing to consider]
- **Case-by-case**: [Situations to evaluate individually]
- **Deal-breakers**: [What you won't accept]

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
