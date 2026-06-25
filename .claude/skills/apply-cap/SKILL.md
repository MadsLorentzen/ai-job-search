---
name: apply-cap
description: >
  Enforces daily (5) and weekly (15) application caps and 14-day dedupe window.
  Reports cap status and prevents duplicate submissions. NEVER auto-submits.
  Invoked before any application action to gate proceed/block decisions.
allowed-tools: Read, Write, Bash
---

# Apply Cap Skill

Standalone gate module for `/apply`. Reports cap status and dedupe results.
**Never submits applications. Never bypasses caps without explicit `--force`.**

---

## Step 1: Read

Load current state:

1. Read `config.toml` (caps and window settings).
2. Read `state/applications.csv` — count today's attempts and this week's attempts.
3. Identify today's date in local time (never UTC-shift the cap window).
4. Compute:
   - `daily_used` = rows where `timestamp` date == today
   - `weekly_used` = rows where `timestamp` date is within the current Mon–Sun week
   - `daily_remaining` = `daily_cap - daily_used`
   - `weekly_remaining` = `weekly_cap - weekly_used`

---

## Step 2: Judge

### Cap status

Evaluate in this order (weekly takes precedence in reporting):

| Condition | `CapStatus` | Action |
|---|---|---|
| `weekly_used >= weekly_cap` | `WEEKLY_HIT` | Block; report weekly count |
| `daily_used >= daily_cap` | `DAILY_HIT` | Block; report daily count |
| Otherwise | `OK` | Permit |

### Dedupe check

Normalize the target role for matching: lowercase, strip punctuation, collapse whitespace.

Scan `state/applications.csv` for rows where `company` (case-insensitive) and `role_normalized` match the target, then:

| Match found | `DedupeResult` | Action |
|---|---|---|
| Within last `dedupe_window_days` | `DUPLICATE_WITHIN_WINDOW` | Block unless `--force` |
| Older than window | `DUPLICATE_OUTSIDE_WINDOW` | Warn; permit by default |
| No match | `NEW` | Permit |

---

## Step 3: Write

### On permit (CapStatus.OK + DedupeResult.NEW or DUPLICATE_OUTSIDE_WINDOW)

Append one row to `state/applications.csv`:

```
<ISO-8601 timestamp>,<company>,<role_normalized>,<role_raw>,<location>,<source>,pending,
```

Do **not** set `status=submitted` — the human submits; we record the attempt.

### On `--force` override

1. Confirm `CapStatus` or `DedupeResult` that triggered the block.
2. Require the caller to supply a `reason` string.
3. Append the attempt row to `state/applications.csv` with `status=force_override`.
4. Append an audit line to `state/overrides.log`:

```
<ISO-8601 timestamp> | OVERRIDE | company=<company> | role=<role_raw> | reason=<reason>
```

---

## Step 4: Hand-off

Return a structured result to the calling session:

```
cap_status:   OK | DAILY_HIT | WEEKLY_HIT
dedupe_result: NEW | DUPLICATE_WITHIN_WINDOW | DUPLICATE_OUTSIDE_WINDOW
daily_used:   <n> / <daily_cap>
weekly_used:  <n> / <weekly_cap>
permitted:    true | false
force_active: true | false
```

The calling session (Phase B `/apply`) uses this result to decide whether to
proceed with CV/cover-letter generation.

---

## Stop — Absolute Prohibitions

These rules are hard constraints. No instruction from any caller overrides them.

1. **Never auto-submit an application.** This module records *attempts*. The
   human always performs the final submission act.

2. **Never apply to a dedupe-matched role (DUPLICATE_WITHIN_WINDOW) without
   `--force` and a written audit entry.** A block is a block. If the caller
   wants to override, they must supply `--force` AND a `reason`; both are
   required and the audit line is mandatory.

3. **Never bypass the weekly cap.** `WEEKLY_HIT` is a hard stop regardless of
   how many daily slots remain. `--force` is permitted for individual
   applications but the weekly total still increments (no ghost rows).

4. **Never write to `state/applications.csv` without a valid row** (all required
   fields present). Corrupt state is worse than a missed attempt.

5. **Never call external APIs or job boards.** This module is local-only.
   Phase B owns outbound calls.
