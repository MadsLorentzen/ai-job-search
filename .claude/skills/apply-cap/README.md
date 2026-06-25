# apply-cap

Standalone cap + dedupe gate for the `/apply` skill. Phase B calls this module
before generating any CV or cover letter.

---

## Locked config (2026-06-24)

| Setting | Value |
|---|---|
| `daily_cap` | 5 attempts per calendar day (local time) |
| `weekly_cap` | 15 attempts per Mon–Sun week (local time) |
| `dedupe_window_days` | 14 days (same company + normalized role = block) |

Change only by explicit decision — update `config.toml` and document the date.

---

## Files

```
.claude/skills/apply-cap/
├── SKILL.md              # Read/Judge/Write/Hand-off/Stop workflow
├── config.toml           # Locked cap values
├── apply_cap.py          # ApplyCapEvaluator class
├── test_apply_cap.py     # pytest suite
└── README.md             # this file

state/
├── applications.csv      # gitignored — written at runtime
├── applications.example.csv  # tracked — header template for new installs
└── overrides.log         # gitignored — --force audit trail
```

---

## Quick start

```python
from pathlib import Path
from apply_cap import ApplyCapEvaluator

evaluator = ApplyCapEvaluator()  # reads config.toml, roots state at repo root

result = evaluator.evaluate(company="Palantir", role_raw="Forward Deployed Engineer")

if result.permitted:
    evaluator.record_attempt(
        company="Palantir",
        role_raw="Forward Deployed Engineer",
        location="Remote",
        source="LinkedIn",
    )
    # → hand off to Phase B for CV/cover letter generation
else:
    print(f"Blocked: cap={result.cap_status.name}, dedupe={result.dedupe_result.name}")
    print(f"Daily: {result.daily_used}/{result.daily_cap}  Weekly: {result.weekly_used}/{result.weekly_cap}")
```

### Force override (--force)

Only call this after presenting the block reason to the user and receiving
explicit confirmation. A `reason` string is required; empty reason raises
`ValueError`.

```python
result = evaluator.evaluate(..., force=True, force_reason="Role re-opened; HM confirmed OK")
if result.permitted:
    evaluator.force_override(
        company="Palantir",
        role_raw="Forward Deployed Engineer",
        reason="Role re-opened; HM confirmed OK",
    )
```

`force_override()` writes both the CSV row (status=`force_override`) and an
audit line to `state/overrides.log`.

---

## CapCheckResult fields

| Field | Type | Description |
|---|---|---|
| `cap_status` | `CapStatus` | `OK`, `DAILY_HIT`, or `WEEKLY_HIT` |
| `dedupe_result` | `DedupeResult` | `NEW`, `DUPLICATE_WITHIN_WINDOW`, or `DUPLICATE_OUTSIDE_WINDOW` |
| `daily_used` | `int` | Attempts logged today |
| `daily_cap` | `int` | Configured daily cap (5) |
| `weekly_used` | `int` | Attempts logged this week |
| `weekly_cap` | `int` | Configured weekly cap (15) |
| `permitted` | `bool` | `True` if Phase B may proceed |
| `force_active` | `bool` | `True` if `--force` was passed |
| `duplicate_date` | `date \| None` | Date of the matched prior attempt, if any |
| `daily_remaining` | `int` | Property: `daily_cap - daily_used` |
| `weekly_remaining` | `int` | Property: `weekly_cap - weekly_used` |

---

## Decision rules (cap precedence)

1. `WEEKLY_HIT` is checked first — weekly cap takes precedence over daily.
2. `DAILY_HIT` is checked second.
3. `DUPLICATE_WITHIN_WINDOW` blocks regardless of cap status (unless `--force`).
4. `DUPLICATE_OUTSIDE_WINDOW` warns but does not block.

---

## Running tests

```bash
# From repo root
python3 -m pytest .claude/skills/apply-cap/test_apply_cap.py -v

# Install pytest if missing
pip install --user pytest
```

All 20+ tests run against a temp directory — no production state is touched.

---

## Phase B integration contract

Phase B (`/apply` main workflow) must:

1. Call `evaluator.evaluate(company, role_raw)` before doing any document work.
2. If `result.permitted is False` and no `--force`: **stop and report the block** to the user.
3. If `--force` supplied: call `evaluator.force_override(...)` before generating documents.
4. After user confirms submission intent (human submits, not the agent): call
   `evaluator.record_attempt(...)` to log the attempt.
5. Never call `record_attempt` or `force_override` speculatively — only after
   the user has confirmed they want to apply.

**Never auto-submit.** This module reports; humans decide and act.
