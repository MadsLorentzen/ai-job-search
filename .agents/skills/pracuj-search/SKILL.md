---
name: pracuj-search
description: Searches Pracuj.pl (Polish job board) for relevant postings
---

# pracuj-search

Searches Pracuj.pl, the largest Polish job board.

> **Warning:** Pracuj.pl employs aggressive Cloudflare bot protection. The base CLI scripts provided here are scaffolds. To make them work, you will need to implement a headless browser (e.g. Playwright) or use an API bypassing service.

## Commands

### `search`

Searches for job postings. (Currently requires implementation of Cloudflare bypass).

**Flags:**
- `--query`, `-q`: Keyword to search for.
- `--location`, `-l`: City or location.
- `--limit`: Maximum number of results to return.
- `--format`: Output format (`json`, `table`, `plain`).

### `detail`

Fetches the full description and salary details for a specific posting.

**Arguments:**
- `<id|url>`: The job ID or the full Pracuj.pl URL.
