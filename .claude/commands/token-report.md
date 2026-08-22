# /token-report - Agent Token-Usage Trends and Improvement Suggestions

You are reporting on how many tokens this project's background agent dispatches have consumed, and surfacing concrete, evidence-based suggestions for reducing cost — not a vague "consider optimizing" but specific patterns found in the actual data.

---

## Step 1: Sync the Log

Run the extraction script to pull in any agent completions since the log was last updated:

```bash
bun run job_scraper/extract_agent_usage.js
```

This is idempotent — safe to run every time, it only appends rows for `task_id`s not already in the CSV. Report how many new rows (if any) it found before moving on.

See the script's own header comment for how this actually works: Claude Code completion notifications live as `"type":"queue-operation"` transcript entries (not as a `tool_result` on the originating `Agent` tool call), each `content` field holding the full `<task-notification>` text verbatim — task-id, status, a `<summary>` line the description is extracted from, and a `<usage>` block for genuinely completed agents.

## Step 2: Load the Data

Read `job_scraper/agent_token_log.csv`. Columns: `date,company,role,task_type,subagent_tokens,tool_uses,duration_ms,notes,description,task_id`.

- `company`/`role`/`task_type` are optional manually-curated columns; most rows (auto-extracted) leave these blank and carry everything in `description` instead. Don't treat blank company/role as missing data; read `description` for those rows.
- Rows with no `subagent_tokens` value are dispatches that never produced a `<usage>` block — almost always `status: failed`/`killed`/`stopped` in `notes`, or a non-agent background command (dashboard server starts, curl calls, Monitor events) that this script also picks up since it scans every `queue-operation` entry, not just `/apply`-style agents. Filter those out of cost totals, but count them separately — a high failure rate is itself a finding.

## Step 3: Analyze

Compute and report:

1. **Total tokens consumed** (sum of `subagent_tokens` across rows that have a value) and **total dispatch count**, split into completed vs. failed/killed/stopped.
2. **Failure rate** — what fraction of dispatches never completed. If this is high, that's the headline finding, not a footnote: a failed dispatch still consumed tokens before dying (even though `subagent_tokens` is empty for it, since the harness only reports usage on clean completion) — token spent on a lost cause is the worst kind of cost.
3. **Cost by pattern**, grouped by what the `description` text indicates the dispatch was doing (infer categories like: fresh full-pipeline run, resume/finish an existing draft, evaluation-only, batch triage, review pass, ad-hoc background command) — report average and median tokens per category. This is where the real signal lives: task *type* drives cost far more than elapsed time does.
4. **Trend over `date`** — is average cost per completed dispatch going up, down, or flat across the session's dates? Call out any single dispatch that's a clear outlier (e.g. an order of magnitude above its category's median) and try to explain why from its `notes`/`description` if there's a clue.
5. **Batch-size patterns** — for batch-style dispatches, does a larger batch (more items per dispatch) correlate with a higher failure rate or cost-per-item? This directly informs whether current batch sizing is well-tuned.

## Step 4: Present Tangible Suggestions

Every suggestion must trace to a specific number or pattern from Step 3 — no generic advice. Format:

> **Finding:** <the specific number/pattern>
> **Suggestion:** <the specific, actionable change>

Cover at minimum:
- Whether the failure rate suggests a batch-size or pacing change
- Which task category is most expensive and whether a cheaper resume-based approach (picking up from an existing partial artifact instead of starting over) is applicable more broadly
- Any specific outlier dispatch worth a root-cause look — an order-of-magnitude spike above its category's median is usually traceable to a specific bug or missing shortcut once you check what that one dispatch was actually doing

## Step 5: Offer Next Steps

Ask whether the user wants:
- The failure-rate/cost findings folded into a memory note (if they represent a durable pattern, not a one-off)
- Any specific outlier investigated further
- The report saved anywhere, or just presented in the response
