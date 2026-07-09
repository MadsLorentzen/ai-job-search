---
name: elempleo-search
version: 1.0.0
description: >
  Search for jobs on Elempleo Colombia (elempleo.com/co). Use this skill whenever
  the user wants to find job openings in Colombia, search for vacancies on Elempleo,
  or look up Colombian job listings. Trigger phrases include: elempleo, elempleo.com,
  elempleo colombia, ofertas de empleo colombia, trabajo en colombia, vacantes colombia,
  empleos colombia, buscar trabajo colombia, bolsa de empleo colombia, ofertas laborales,
  empleos bogota, empleos medellin, empleos cali, trabajo bogota, colombian jobs,
  el empleo colombia.
context: fork
allowed-tools: Bash(bun run .agents/skills/elempleo-search/cli/src/cli.ts *)
---

# Elempleo Colombia Search Skill

Search live job listings from [Elempleo Colombia](https://www.elempleo.com/co/).
No authentication needed. One of the largest job boards in Colombia, covering all sectors
and regions.

> **Personal use only.** This uses Elempleo's public pages; automated access is against
> their Terms of Service. Keep volume low, don't use it commercially or for bulk data
> collection, and run it on your own responsibility.

## When to use this skill

- Search for job openings in Colombia by keyword, job title, or skill
- Find jobs in a specific Colombian city (use `--location`)
- Filter jobs by recency (posted today, last week, last month)
- Get the full description of a specific job listing with salary and contract details
- Explore the Colombian job market across all sectors

## Commands

### Search job listings

```bash
bun run .agents/skills/elempleo-search/cli/src/cli.ts search --query "<keywords>" [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — **Required.** Keyword search (job title, skill, role).
- `--location <text>` / `-l <text>` — City (e.g. `"Bogotá"`, `"Medellín"`, `"Cali"`).
- `--jobage <days>` — filter by posting age: `1`, `7`, `14`, `30`.
- `--page <n>` — page number (1-indexed).
- `--limit <n>` — cap total results the CLI outputs (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/elempleo-search/cli/src/cli.ts detail <url|id> [--format json|plain]
```

Pass the full job URL from `search` results. Returns the full job description, salary range,
contract type, work modality, and experience level.

---

## How to use effectively

**Always start with `search`.** Pass the job title, skill, or profession as `--query`.

**Use `--location`** to narrow to a specific city (e.g. `--query "ingeniero" --location "Medellín"`).

**Use `--jobage 7` for fresh listings** or `--jobage 1` for today's postings.

**Natural workflow: `search` → `detail`.**
1. Use `search` to find matching jobs.
2. Copy a job URL from the results and pass it to `detail`.

---

## Usage examples

### Software engineer jobs

```bash
bun run .agents/skills/elempleo-search/cli/src/cli.ts search \
  --query "ingeniero software" \
  --format table
```

### Data analyst jobs in Bogota, last 7 days

```bash
bun run .agents/skills/elempleo-search/cli/src/cli.ts search \
  --query "analista datos" \
  --location "Bogotá" \
  --jobage 7 \
  --format table
```

### Marketing jobs in Medellin

```bash
bun run .agents/skills/elempleo-search/cli/src/cli.ts search \
  --query "marketing" \
  --location "Medellín" \
  --format table
```

### Full detail for a specific job

```bash
bun run .agents/skills/elempleo-search/cli/src/cli.ts detail \
  https://www.elempleo.com/co/ofertas-trabajo/tecnico-electricista-ami-perdidas-1886736527 \
  --format plain
```

---

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, data processing |
| `table` | Quick human-readable overview |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

---

## Notes

- All data is from the public `elempleo.com/co` pages — no credentials required.
- Job IDs are 10-digit numeric integers. The `detail` command works with a full URL.
- Salary is shown as a range in Colombian pesos (COP), e.g. `$2 a $2,5 millones`.
- Contract types: Indefinido, Fijo (Definido), Obra o labor, Aprendizaje, Prestación de servicios.
- Work modalities: Presencial, Remoto, Híbrido, Teletrabajo, Desde casa.
- Elempleo is part of Leadearsearch S.A.S. and is linked to the Colombian Servicio Público de Empleo (SPE).
