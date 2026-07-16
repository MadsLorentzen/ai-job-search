---
name: instahyre-search
version: 1.0.0
description: >
  Use this skill to search live tech job listings on Instahyre.com — a
  premium tech-focused job portal in India used by top startups and product
  companies. Best for software engineering, AI/ML, data, and product roles
  at funded startups and mid-size tech companies in India.
  Trigger phrases: instahyre jobs, tech jobs India, startup jobs India,
  product company jobs India.
context: fork
enabled: true
allowed-tools: Bash(node .agents/skills/instahyre-search/cli/src/cli.js *)
---

# Instahyre Search Skill

Search live job listings from **Instahyre.com** — India's premium tech job portal
used by top startups and product companies. Best for software, AI/ML, data, and
product roles. No authentication required.

## ⚠️ Personal use only
Keep volume low. For personal job searching only.

## Commands

### Search job listings
```bash
node .agents/skills/instahyre-search/cli/src/cli.js search -q "<keywords>" [flags]
```

Key flags:
- `--query, -q <text>` — job title or keywords (required)
- `--location, -l <text>` — city e.g. "Noida", "Bangalore", "Remote"
- `--limit, -n <n>` — max results (default 20)
- `--format json|table` — default json

### Examples
```bash
node .agents/skills/instahyre-search/cli/src/cli.js search -q "software engineer" -l "Noida" --format table
node .agents/skills/instahyre-search/cli/src/cli.js search -q "machine learning" --format table
node .agents/skills/instahyre-search/cli/src/cli.js search -q "full stack" -l "Remote" --format table
```
