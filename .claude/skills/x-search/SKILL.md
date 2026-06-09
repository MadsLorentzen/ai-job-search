# X (Twitter) Search

**name:** x-search
**description:** Reads and searches job/hiring posts on X (Twitter) via the llm-cli-gateway using Grok as the model. Reads a specific X post URL, or searches X for hiring posts by keyword/location/handle. Deduplicates across runs. Triggers on: x post, twitter job, read this x post, read this tweet, search x, find jobs on x, who is hiring on twitter, x.com/<...>/status/<...>.
**allowed-tools:** Read, Write, Edit, Glob, Grep, Skill, AskUserQuestion

---

## How It Works

Unlike LinkedIn (whose public job pages are readable with plain WebFetch — see
the `linkedin-search` skill), **X is auth-walled and JS-heavy**: `WebFetch`,
Exa `crawling_exa`/`web_fetch_exa`, and reader proxies all fail or return error
pages for `x.com` URLs.

The working mechanism is the **multi-LLM gateway (`gtwy` /
`llm-cli-gateway`) with Grok as the model** — Grok has native, live access to
X's search and post data. All X reads and searches in this skill go through
`mcp__gtwy__grok_request` (or `..._async` for long searches). No WebFetch, no
Exa for the X content itself.

> If the `gtwy` MCP server is not connected, this skill cannot run — tell the
> user X access requires the llm-cli-gateway + Grok and stop. Do **not** silently
> fall back to WebFetch/Exa on `x.com`; they do not work.

This skill is country-agnostic; pass a location in the query and Grok scopes
the X search accordingly.

### Grok call mechanics (learned the hard way — follow exactly)

1. **Do NOT pass `effort` / `reasoningEffort`.** The default Grok model
   (`grok-build`) rejects it with `400 ... does not support parameter
   reasoningEffort`. Send a plain `prompt` only.
2. **The sync response envelope often returns metadata only** (model,
   `correlationId`, `durationMs`, `exitCode`) with no visible text. When that
   happens, read the actual answer back with
   `mcp__gtwy__llm_request_result` using the returned `correlationId`. This also
   recovers the `"orphaned after gateway restart"` case — the response is still
   persisted in the flight recorder.
3. **Latency is ~30–45s.** `grok_request` auto-defers to a pollable job past the
   sync deadline. For multi-query searches, prefer
   `mcp__gtwy__grok_request_async` and poll with `llm_job_status` /
   `llm_job_result`.
4. **Grok cites posts as `[[n]](https://x.com/<handle>/status/<id>)`.** Capture
   those `status` URLs — they are the canonical post links you store and pass to
   `/apply`.

---

## Invocation

Two modes, auto-detected from the user's input:

### Mode A — Read a specific X post (URL given)
Triggered when the input contains an `x.com/.../status/...` (or
`twitter.com/...`) URL.
> "read this x post — https://x.com/HarshalCh8411/status/2064033788804661635"

### Mode B — Search X for hiring posts (query given)
Triggered when the input is a query, not a URL.
> "who's hiring AI engineers on X in Sydney"
> "/x staff ML engineer remote #hiring"
> "find recent founder 'we're hiring' posts for RAG / agents roles"

Optional Mode B arguments:
- A location (e.g. "Sydney" / "remote AUS") — defaults to the candidate's
  location in `CLAUDE.md`.
- A handle to scope to (e.g. "from:@someVC") or a hashtag (`#hiring`).
- A recency hint ("this week", "today").

---

## Execution Steps

### Step 0: Preconditions & State (both modes)

1. Confirm the `gtwy` MCP server is available (a `mcp__gtwy__grok_request` tool
   exists). If not, stop with the message above.
2. Read `job_scraper/seen_jobs.json` (create `{"seen": {}}` if missing).
3. Read `job_search_tracker.csv` to know which company+role pairs are tracked.

---

### Mode A — Read a specific X post

1. Call `mcp__gtwy__grok_request` with a plain prompt (no `effort`):

   > "Fetch this live X post: <URL>. Return as structured fields: author handle,
   > post date, the full post text verbatim, whether it is a job/hiring post,
   > and — if it is — the role title, company, location, work mode
   > (onsite/hybrid/remote), seniority, key requirements, comp if stated, and
   > any outbound application link (careers page, lnkd.in, form). Also list any
   > linked thread posts. If you cannot access the post, say so explicitly."

2. If the envelope has no text, read it back via `llm_request_result` with the
   `correlationId`.
3. Present a clean summary. X hiring posts are often informal founder threads
   that **link out** to the real application — surface that outbound apply link
   prominently.
4. Record it in `seen_jobs.json` (Step 4).
5. Offer a full fit evaluation via **`/apply <url-or-pasted-text>`** — but only
   if a real profile exists (`CLAUDE.md` has no `[YOUR_...]` placeholders). If
   the profile is still a template, say so and do **not** fabricate a fit score.
   Since X posts are ephemeral and `/apply` may not be able to re-fetch the URL,
   pass the extracted post text to `/apply` rather than relying on the link.

---

### Mode B — Search X for hiring posts

1. Build the search intent (role/skills + location + optional handle/hashtag +
   recency). Call `mcp__gtwy__grok_request_async` (preferred for searches):

   > "Search live X (Twitter) for recent job/hiring posts matching: <role/skills>
   > in <location>, posted within <recency>. Include founder 'we're hiring'
   > posts, #hiring posts, and recruiter posts. Return up to <N> results as a
   > list; for each: author handle, post URL (the x.com/.../status/... link),
   > post date, role title, company, location, work mode, and the outbound
   > application link if present. Exclude reposts/duplicates and closed roles.
   > If you cannot access live X data, say so explicitly."

2. Poll `llm_job_status` → collect with `llm_job_result` (or
   `llm_request_result` by `correlationId`).
3. **Dedup:** drop any post URL already in `seen_jobs.json` and any company+role
   already in `job_search_tracker.csv`.
4. **Quick fit assessment** for each new post (signal only, not the full
   `/apply` evaluation): High / Medium / Low. Skip scoring if the profile is
   still a template (say `/setup` is needed first).

---

### Step 4: Deduplicate & Store (both modes)

Add every X post seen (presented or skipped) to `job_scraper/seen_jobs.json`:

```json
{
  "seen": {
    "<status-id-or-post-url>": {
      "title": "...",
      "company": "...",
      "author_handle": "@...",
      "location": "...",
      "url": "https://x.com/<handle>/status/<id>",
      "apply_link": "https://...",
      "source": "x",
      "first_seen": "YYYY-MM-DD",
      "fit": "high|medium|low|unknown",
      "status": "new|skipped|evaluated"
    }
  }
}
```

Use today's date from the session context for `first_seen`. Only present posts
not already seen or tracked.

### Step 5: Present Results (Mode B)

Sort by fit (high first):

```
## New X Hiring Posts — YYYY-MM-DD

Found X new posts (Y high, Z medium, W low).

| # | Fit | Role | Company | Author | Location | Apply | Post |
|---|-----|------|---------|--------|----------|-------|------|
| 1 | High | ... | ... | @... | ... | [Apply](...) | [Post](...) |
```

For each high-match post add 2–3 bullets: why it matches, key requirements to
check, any red flags (location outside commute range, vague/anonymous poster,
no verifiable company).

Then ask:
> "Want a full evaluation of any of these? Give me the number(s) and I'll run
> `/apply` on it."

### Step 6: Hand off

If the user picks a post, invoke **`/apply`** with the extracted post text (not
just the URL, since X may not be re-fetchable by WebFetch). If they decide to
apply, add a row to `job_search_tracker.csv` with `source` = `x` and the post
URL in `source`/`notes`.

---

## Important Rules

1. **Grok is the only X fetch mechanism.** Never WebFetch/Exa an `x.com` URL —
   it fails. All X reads/searches go through `gtwy` + Grok.
2. **Never pass `effort`/`reasoningEffort`** to `grok_request` (400 on the
   default model). Plain `prompt` only.
3. **Always read back by `correlationId`** when the sync envelope lacks text.
4. **Never fabricate posts or fit scores.** Only present posts Grok actually
   returned, with their real `status` URLs; only score fit against a real
   profile.
5. **Verify before trusting.** X hiring posts are unvetted — an anonymous/low-
   signal poster, a company that can't be confirmed, or a sketchy apply link is
   a red flag to surface, not hide. Cross-check the company independently when a
   post advances to `/apply`.
6. **Respect deduplication** against `seen_jobs.json` and
   `job_search_tracker.csv`.
7. **Honour location**; flag (don't silently drop) out-of-range roles; remote
   overrides a location mismatch.

---

## Usage Examples

### Read one post
```
read this x post https://x.com/HarshalCh8411/status/2064033788804661635
```
→ Mode A: `grok_request` fetches the post → extract job fields + outbound apply
link → offer `/apply`.

### Search X by role + city
```
/x AI engineer Sydney #hiring this week
```
→ Mode B: `grok_request_async` searches live X → poll → dedup → table.

### Scope to a person/VC's hiring posts
```
find recent "we're hiring" posts from founders building agents, remote AUS ok
```
→ Mode B with a founder/we're-hiring framing in the Grok search prompt.
