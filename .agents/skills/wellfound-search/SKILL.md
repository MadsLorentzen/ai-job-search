---
name: wellfound-search
version: 1.0.0
description: >
  Use this skill to search live startup and tech job listings on Wellfound.com
  (formerly AngelList Talent) — the leading global platform for startup jobs.
  Best for software engineering, AI/ML, data, and product roles at funded
  startups worldwide including India. Trigger phrases: wellfound jobs,
  angellist jobs, startup jobs, funded startup hiring, remote startup jobs.
context: fork
enabled: true
allowed-tools: Bash(node .agents/skills/wellfound-search/cli/src/cli.js *)
---

# Wellfound Search Skill

Search live job listings from **Wellfound.com** (formerly AngelList Talent) —
the leading platform for startup jobs globally. Great for funded startups,
remote roles, and equity-offering positions. No authentication required for search.

## ⚠️ Personal use only
Keep volume low. For personal job searching only.

## Commands

### Search job listings
```bash
node .agents/skills/wellfound-search/cli/src/cli.js search -q "<keywords>" [flags]
```

Key flags:
- `--query, -q <text>` — job title or keywords (required)
- `--location, -l <text>` — location e.g. "India", "Remote", "Bangalore"
- `--remote` — filter remote jobs only
- `--limit, -n <n>` — max results (default 20)
- `--format json|table` — default json

### Examples
```bash
node .agents/skills/wellfound-search/cli/src/cli.js search -q "software engineer" -l "India" --format table
node .agents/skills/wellfound-search/cli/src/cli.js search -q "AI engineer" --remote --format table
node .agents/skills/wellfound-search/cli/src/cli.js search -q "full stack" -l "Remote" --format table
```
