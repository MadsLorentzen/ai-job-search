---
name: justjoin-search
description: Searches JustJoin.it (Polish IT job board) for relevant postings
---

# justjoin-search

Searches JustJoin.it, the leading Polish IT job board.

> **Warning:** JustJoin.it's terms of service prohibit automated scraping. This skill is intended for personal, low-volume use only. Do not run it in tight loops.

## Commands

### `search`

Searches for job postings. The API limits results to the most recent ones.

**Flags:**
- `--query`, `-q`: Keyword to search for (filters locally).
- `--location`, `-l`: City or location (filters locally).
- `--limit`: Maximum number of results to return (default: 20).
- `--format`: Output format (`json`, `table`, `plain`).

**Examples:**
- `bun run src/search.ts -q "Product Manager" -l "Warszawa" --format table`
- `bun run src/search.ts -q "Data" -l "Remote"`

### `detail`

Fetches the full description and salary details for a specific posting.

**Arguments:**
- `<slug|url>`: The job ID (slug) or the full JustJoin.it URL.

**Examples:**
- `bun run src/detail.ts "craftware-senior-full-stack-developer"`
- `bun run src/detail.ts "https://justjoin.it/offers/craftware-senior-full-stack-developer"`

## Notes

- This tool fetches the latest 100 offers via API and filters them locally using JavaScript. This bypasses the need for complex undocumented query parameters.
- The `Version: 2` HTTP header must be present in all requests.
