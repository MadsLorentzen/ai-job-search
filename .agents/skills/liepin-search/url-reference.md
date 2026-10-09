# Liepin Search URL Reference

## Authoritative sources

- Official authorization page: `https://www.liepin.com/mcp/auth`
- Official CLI repository: `https://github.com/liepin-tech-2026/liepin-cil`
- Repository default branch checked: `main`
- Repository snapshot checked: 2026-09-01

## Upstream command

```text
liepin-cli job search --job-name <query> --address <city> --page <zero-based-page> --output json
```

The CLI posts to its configured API base (default `https://open-agent.liepin.com`)
at `/mcp/search-job` with JSON fields such as `jobName`, `address`, and `page`.
The upstream response is passed through as JSON; the exact response envelope
is not guaranteed by the repository schema, so the adapter accepts common
`jobs`, `results`, `data`, or top-level array envelopes and validates each
record defensively.

## Field mapping

| Standard field | Accepted upstream names |
|---|---|
| `id` | `id`, `jobId`, `job_id`, `positionId`, `position_id` |
| `title` | `title`, `jobName`, `job_name`, `positionName`, `position_name` |
| `company` | `company`, `companyName`, `company_name`, `compName` |
| `location` | `location`, `address`, `city`, `workAddress` |
| `date` | `date`, `publishTime`, `publish_time`, `createTime`, `createdAt` |
| `url` | `url`, `jobUrl`, `job_url`, `detailUrl`, `detail_url` |
| `salary` | `salary`, `salaryDesc`, `salary_desc`, `salaryText` |
| `experience` | `experience`, `workExperience`, `work_experience` |
| `education` | `education`, `eduLevel`, `edu_level` |

Missing values remain `null`; records without an ID, title, or URL are not
saved. The official CLI currently documents `job search` and `job apply`, but
no job-detail command. `job apply` is outside this adapter's allowlist.

## Access and limits

The official authorization page documents a 90-day token lifetime and 60
requests/minute shared quota. Token setup is interactive and must be performed
by the user. Do not put credentials in repository files or CI.
