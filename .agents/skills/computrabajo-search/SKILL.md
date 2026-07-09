---
name: computrabajo-search
version: 1.0.0
description: >
  Search for jobs on Computrabajo Colombia (co.computrabajo.com). Use this skill
  whenever the user wants to find job openings in Colombia, search for vacancies
  on Computrabajo, or look up Colombian job listings. Trigger phrases include:
  computrabajo, computrabajo colombia, ofertas de empleo colombia, trabajo en colombia,
  vacantes colombia, empleos colombia, buscar trabajo colombia, bolsa de empleo colombia,
  ofertas laborales colombia, empleos bogota, empleos medellin, empleos cali,
  trabajo bogota, trabajo medellin, work in colombia, colombian jobs.
context: fork
allowed-tools: Bash(bun run .agents/skills/computrabajo-search/cli/src/cli.ts *)
---

# Computrabajo Colombia Search Skill

Search live job listings from [Computrabajo Colombia](https://co.computrabajo.com).
No authentication needed. Covers thousands of job postings across all sectors in Colombia.

> **Personal use only.** This uses Computrabajo's public pages; automated access is
> against their Terms of Service. Keep volume low, don't use it commercially or for
> bulk data collection, and run it on your own responsibility.

## When to use this skill

- Search for job openings in Colombia by keyword, job title, or skill
- Find jobs in a specific Colombian city or department (use `--location`)
- Filter jobs by recency (posted today, last 7 days, last 30 days)
- Get the full description of a specific job listing
- Explore the Colombian job market for a given profession

## Commands

### Search job listings

```bash
bun run .agents/skills/computrabajo-search/cli/src/cli.ts search --query "<keywords>" [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — **Required.** Keyword search (job title, skill, role).
- `--location <text>` / `-l <text>` — City or department (e.g. `"Bogotá"`, `"Medellín"`, `"Cali"`, `"Antioquia"`).
- `--jobage <days>` — filter by posting age: `1` (today), `7`, `14`, `30`.
- `--page <n>` — page number (1-indexed, ~20 results per page).
- `--limit <n>` — cap total results the CLI outputs (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/computrabajo-search/cli/src/cli.ts detail <url> [--format json|plain]
```

Pass the full job URL from `search` results. Returns the full job description, salary, contract type, and work modality.

---

## How to use effectively

**Always start with `search`.** Pass the job title, skill, or profession as `--query`.

**Combine with `--location`** to narrow by city or department (e.g. `--query "ingeniero software" --location "Bogotá"`).

**Use `--jobage 7` or `--jobage 1` for fresh listings.** Without it, results include all postings.

**Natural workflow: `search` → `detail`.**
1. Use `search` to find matching jobs and their full URLs.
2. Call `detail <url>` to get the full description, salary, and apply details.

**Use `--format table` for quick scanning**, `--format json` for data processing.

---

## Usage examples

### Software engineer jobs in Bogota

```bash
bun run .agents/skills/computrabajo-search/cli/src/cli.ts search \
  --query "ingeniero software" \
  --location "Bogotá" \
  --format table
```

### Data analyst jobs posted in the last 7 days

```bash
bun run .agents/skills/computrabajo-search/cli/src/cli.ts search \
  --query "analista datos" \
  --jobage 7 \
  --format table
```

### Python developer jobs across Colombia

```bash
bun run .agents/skills/computrabajo-search/cli/src/cli.ts search \
  --query "python developer" \
  --format table
```

### Full detail for a specific job (pass the URL from search)

```bash
bun run .agents/skills/computrabajo-search/cli/src/cli.ts detail \
  https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-ingeniero-de-desarrollo-de-software-junior-en-bogota-dc-F74E146623AC0A6E61373E686DCF3405 \
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

- All data is from the public `co.computrabajo.com` pages — no credentials required.
- Job IDs are 32-character hex strings; the `detail` command works best with a full URL.
- Location support is limited to city/department name — include specific cities in `--location`.
- Salary is shown in Colombian pesos (COP) where available.
- Contract types include: Indefinido, Fijo, Obra o labor, Aprendizaje, Prestación de servicios.
- Work modalities: Presencial, Remoto, Híbrido (Presencial y remoto).
