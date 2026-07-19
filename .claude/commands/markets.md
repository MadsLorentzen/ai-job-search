# /markets - Community Market Adaptations Table

You are generating an up-to-date table of community-maintained market/language forks of this project, sourced live from the upstream discovery thread: [MadsLorentzen/ai-job-search#78](https://github.com/MadsLorentzen/ai-job-search/discussions/78) ("Community forks & adaptations").

This repo's core stays deliberately universal - country-specific portals, language adaptations, and alternative agent-harness ports live in forks, not upstream. Discussion #78 is the maintainer-curated discovery hub for those forks. This command turns that thread into a table you can scan, instead of you reading the whole discussion by hand. It is **read-only** - it never writes files, never modifies the discussion, and never touches personal data.

`$ARGUMENTS` may contain a filter (a market name, country, language, or portal name, e.g. `/markets spain` or `/markets linkedin`), or nothing for the full table.

Follow these steps **in order**.

---

## Step 1: Fetch the Discussion

Prefer the GitHub API over scraping - it returns clean markdown instead of rendered HTML.

1. Check `gh auth status`. If authenticated, fetch via GraphQL:
   ```
   gh api graphql -f query='
   query {
     repository(owner: "MadsLorentzen", name: "ai-job-search") {
       discussion(number: 78) {
         title
         url
         updatedAt
         bodyText
         comments(first: 100) {
           totalCount
           nodes {
             author { login }
             bodyText
             createdAt
           }
         }
       }
     }
   }'
   ```
2. If `gh` is unavailable or unauthenticated, fall back to `WebFetch` on `https://github.com/MadsLorentzen/ai-job-search/discussions/78` with a prompt asking for the full original-post content (fork list and portal-skill index table) and all comments verbatim. Note in the final output that this fallback path can miss recent edits that only show in the rendered diff, unlike the GraphQL body.
3. If both fail (network, rate limit, thread deleted/renumbered), tell the user plainly and stop - do not fabricate entries from memory. Community fork lists change; a stale hardcoded table is worse than no table.

---

## Step 2: Parse the Curated Tables

The discussion body (`bodyText`) contains two maintainer-curated sections - treat these as the authoritative source, since the maintainer verifies each entry before adding it (code review, provenance check, no personal data leakage):

1. **Known adaptations** - a bullet list, one per fork, each with: a country/harness flag emoji, the fork name/link, the author's `@handle`, and a free-text description of what it adapts (market, language, portals, harness, tracking status e.g. "work branch", "master pending", "modifies core files").
2. **Portal-skill index** - a markdown table mapping individual job-portal skills to the fork that implements them: Portal | Market | Where (source repo) | Path (e.g. `.agents/skills/itviec-search`).

Extract every row of both into structured form (market, author, repo URL, key features, tracking status / portal, market, source, path). Do not skip rows because they look similar to ones already in this repo (`.agents/skills/`) - the point of the table is to show the full community index, upstream skills included.

---

## Step 3: Check Comments for Unindexed Mentions

Scan `comments.nodes[].bodyText` for fork or portal announcements that read like a reply to the maintainer's "reply below with your fork" / "reply below and I'll add the row" invitations (a repo link plus a description of what it adapts) but that do **not** already appear in the Step 2 tables. These are genuine community contributions the maintainer hasn't folded into the curated index yet.

List these separately and mark them clearly as **unverified / not yet indexed by the maintainer** - do not merge them into the main tables, since they haven't gone through the maintainer's verification step described in the thread (code review, author provenance, security/data-leak check). If `comments.totalCount` exceeds the number fetched (pagination truncated), note that older comments weren't scanned and point to the discussion URL for the full history.

---

## Step 4: Apply Filter (if any)

If `$ARGUMENTS` has a filter term, match it case-insensitively against market/country name, language, author handle, portal name, or repo name across both tables. Show only matching rows, but state at the top what filter was applied and how many rows it excluded. No matches → say so plainly and show the unfiltered table instead of an empty response.

---

## Step 5: Present the Tables

```
## Community Market Adaptations

Source: MadsLorentzen/ai-job-search#78, updated <updatedAt from the discussion>
<filter note, if any>

### Market Forks

| Market | Author | Repository | Key Features | Tracking Status |
|---|---|---|---|---|
| 🇻🇳 Vietnam | @jamesng16 | [ai-job-search-vn](https://github.com/jamesng16/ai-job-search-vn) | ITviec portal skill | tracks upstream |
| ... | ... | ... | ... | ... |

### Portal Skills

| Portal | Market | Source | Path |
|---|---|---|---|
| Jobindex | 🇩🇰 Denmark | this repo | `.agents/skills/jobindex-search` |
| ITviec | 🇻🇳 Vietnam | jamesng16/ai-job-search-vn | `.agents/skills/itviec-search` |
| ... | ... | ... | ... |

### Mentioned in Comments, Not Yet Indexed (unverified)
- **<market/portal>** - <repo link> by @<author>, <what it claims to adapt>. Not yet reviewed/added by the maintainer - read the fork's code yourself before trusting it, same as any code that will run against your career data.
```

Omit the "Mentioned in Comments" section entirely if Step 3 found nothing - don't print an empty header.

After the tables, remind the user how to use a portal-skill row: open the linked fork, read the code, then copy the one skill folder into their own `.agents/skills/` - `/scrape` picks up any installed `*-search` skill automatically. This mirrors the guidance already in the discussion thread; don't invent a different mechanism.

---

## Important Rules

1. **Live data only.** Every run re-fetches the discussion; never reuse a table from earlier in the conversation or from training knowledge without re-fetching, since fork entries are added continuously.
2. **Maintainer-curated rows are authoritative; comment-sourced rows are not.** Keep the two visually and structurally separate - never blend an unverified comment mention into the main tables.
3. **No writes.** This command never edits files in the repo, never posts to the discussion, and never modifies `.agents/skills/`. If the user wants to actually add a portal after seeing the table, point them to `/add-portal`.
4. **No fabrication on fetch failure.** If Step 1 fails entirely, say so and stop rather than presenting a table from memory.
