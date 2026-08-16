# We Work Remotely RSS Reference

Public, unauthenticated RSS endpoints used by this skill.

## All jobs

```
GET https://weworkremotely.com/remote-jobs.rss
```

## By category

```
GET https://weworkremotely.com/categories/<slug>.rss
```

| Slug | Category |
|------|----------|
| `remote-programming-jobs` | Programming |
| `remote-full-stack-programming-jobs` | Full-Stack Programming |
| `remote-front-end-programming-jobs` | Front-End Programming |
| `remote-back-end-programming-jobs` | Back-End Programming |
| `remote-design-jobs` | Design |
| `remote-devops-sysadmin-jobs` | DevOps / SysAdmin |
| `remote-sales-and-marketing-jobs` | Sales and Marketing |
| `remote-customer-support-jobs` | Customer Support |
| `remote-business-exec-jobs` | Business / Exec |
| `remote-copywriting-jobs` | Copywriting |
| `remote-finance-legal-jobs` | Finance / Legal |
| `remote-all-other-jobs` | All Other Remote |

Each feed returns the ~99 most recent live postings as RSS `<item>` elements, with no
pagination and no server-side keyword search.

## Item fields used by this skill

| Field | Meaning |
|-------|---------|
| `<title>` | `"<Company>: <Job title>"` — split on the first `": "` |
| `<region>` | Usually `"Anywhere in the World"` |
| `<country>` / `<state>` | Optional geo hints, often blank |
| `<category>` | Job category (matches the feed taxonomy above) |
| `<type>` | Employment type, e.g. `Full-Time`, `Contract` |
| `<description>` | Full HTML job description (CDATA-wrapped) |
| `<pubDate>` | RFC 822 posting date |
| `<guid>` / `<link>` | Canonical job URL — the slug after `/remote-jobs/` is used as the ID |

## Notes

- No authentication required.
- Respect rate limits — the CLI backs off on 429/5xx.
