---
name: naukri-search
version: 1.0.0
description: >
  Use this skill to search live job listings on Naukri.com — India's largest
  job portal. Covers all roles across tech, non-tech, and domain-specific
  positions in India. Trigger phrases: find jobs on naukri, search naukri,
  naukri jobs, jobs in India, software jobs India, IT jobs Delhi NCR.
context: fork
enabled: true
allowed-tools: Bash(node .agents/skills/naukri-search/cli/src/cli.js *)
---

# Naukri Search Skill

Search live job listings from **Naukri.com** — India's largest job portal.
Covers tech, non-tech, and all domains across India. No authentication required.
Uses Naukri's public job search API.

## ⚠️ Personal use only
Automated access should be kept low-volume and for personal job searching only.

## Commands

### Search job listings
```bash
node .agents/skills/naukri-search/cli/src/cli.js search -q "<keywords>" [flags]
```

Key flags:
- `--query, -q <text>` — job title or keywords (required)
- `--location, -l <text>` — city or region e.g. "Noida", "Delhi", "Remote"
- `--experience <years>` — years of experience e.g. "2" for 2 years
- `--limit, -n <n>` — max results (default 20)
- `--format json|table` — default json

### Examples
```bash
node .agents/skills/naukri-search/cli/src/cli.js search -q "software engineer" -l "Noida" --experience 2 --format table
node .agents/skills/naukri-search/cli/src/cli.js search -q "AI engineer" -l "Delhi NCR" --format table
node .agents/skills/naukri-search/cli/src/cli.js search -q "full stack developer" -l "Remote" --format table
```
