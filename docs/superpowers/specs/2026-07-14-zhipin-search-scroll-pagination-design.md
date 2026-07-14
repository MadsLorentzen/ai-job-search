# zhipin-search: scroll-triggered pagination

## Problem

`.agents/skills/zhipin-search/cli/src/commands/search.ts` scrapes BOSS直聘 search
results with a single `gotoAndWait` + `wait(1)` + one-shot DOM scrape of
`li.job-card-box`. BOSS直聘's result list is an infinite-scroll SPA, so this only
ever captures the first screenful. Verified live: `-q "FDE" -l "上海"` always
returns exactly 15 results, regardless of how many actually exist.

The CLI also has a `--page` flag (`cli.ts`, `SearchOpts.page`) that has never done
anything — `buildSearchUrl(query, cityCode)` in `helpers.ts` takes no page
parameter and BOSS直聘 doesn't paginate by URL; it's scroll-based. `SKILL.md` and
`cli/README.md` already document this honestly as "not yet wired up."

## Empirical findings (spike, live against zhipin.com)

Tested via raw `ego-browser` heredocs against `-q "FDE" -l "上海"` before writing
any code:

- Initial render: 15 cards.
- Each additional batch is **exactly +15 cards**, and a raw `scrollBy(1200-1400)` +
  `wait(1-1.2s)` step only triggers a new batch **every other call** — one step
  advances the viewport without yet reaching the new lazy-load trigger point, the
  next step crosses it. So a naive "did the count grow after *this* step" check
  is not a safe stop signal by itself.
- The list plateaued at **90 cards** and stayed there through 15 more scroll
  attempts — a real ceiling exists per query, and once reached it's stable (no
  flapping).
- The SDK's own `scrollToBottomUntil(predicate, {step, wait, maxSteps})` helper
  was tried with two parameter sets (step 900/wait 1, step 1400/wait 1.2) and in
  both cases exited after exactly 3 internal steps while still at the 15-card
  baseline — it appears to have its own "stuck" heuristic that doesn't tolerate
  this site's every-other-step load pattern. Not used in the implementation for
  that reason.

## Design

### 1. Manual scroll loop (replaces one-shot scrape)

In `buildBrowserScript`, after the existing `gotoAndWait` + initial `wait(1)`,
loop:

```
scrollBy(1400) -> wait(1.2) -> count `li.job-card-box`
```

Stop when the first of these is true:
- **Target reached**: card count ≥ target (see below).
- **Real end-of-list**: 3 consecutive steps with no count increase (empirically,
  genuine growth never produces more than 1 consecutive flat step; 3 is a safe
  margin above that).
- **Safety ceiling**: 12 scroll steps taken (≈6 batches ≈ up to ~105 cards) — a
  hard stop regardless of the above, so a pathological page can't loop forever.

Then run the existing one-shot `DOM_SCRIPT` scrape as today (now over a DOM that
has more cards loaded into it).

### 2. Target count = combination of `--limit` and a conservative default

- If the caller passed `--limit N`, target = N (stop scrolling as soon as enough
  cards are loaded — avoids scrolling further than needed, keeping this tool's
  "handful of searches, not a crawl" posture).
- If `--limit` was not passed (today this means "return everything visible"),
  target defaults to **45** (3 batches) — noticeably more than the current
  hard-capped-at-15 behavior, but well short of scrolling every query to its
  true ceiling by default. This is an internal constant, not a new flag.

### 3. Remove `--page`

Delete it from `cli.ts` (`SearchOpts.page`, parsing, help text), and from any
test that references it. Update `SKILL.md` and `cli/README.md` to describe the
real scroll behavior in place of the "not yet wired up" note.

### 4. Testing

- Extract the stop-decision as a pure function, e.g.
  `shouldStopScrolling({ count, target, noGrowthStreak, steps, maxSteps })  boolean`,
  and unit test it directly (no browser needed) — covers target-reached,
  3-flat-steps, and safety-ceiling branches.
- Update `cli-flag-validation.test.ts` / `parsing.test.ts` for `--page` removal.
- Live verification (manual, not part of the automated suite): re-run
  `-q "FDE" -l "上海"` through the modified CLI and confirm the result count
  moves from the old baseline of 15 to ~45 (default target), and that
  `--limit 60` pulls further (up to the 90-card real ceiling) without exceeding
  the safety ceiling.

### Out of scope

- `detail` command — untouched.
- Sibling portal skills (`linkedin-search`, `jobbank-search`, etc.) — untouched.
- No new npm runtime dependencies (`bun` + `node:child_process` only, unchanged).
- No new user-facing CLI flags beyond removing `--page`.
