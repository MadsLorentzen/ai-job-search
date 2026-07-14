# zhipin-search Scroll Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `zhipin-search`'s `search` command scroll to load more than the first screenful of BOSS直聘 results, and remove the dead `--page` flag it currently ships with.

**Architecture:** `buildBrowserScript` (in `search.ts`) currently emits a single `gotoAndWait` + one-shot DOM scrape. It grows a bounded scroll loop (raw `scrollBy` + `wait` + card-count check, generated as JS source text since the script runs inside `ego-browser`'s sandboxed runtime, not this process) before the existing scrape. The loop's stop decision (target reached / no-growth streak / safety ceiling) is mirrored as a standalone pure TypeScript function (`shouldStopScrolling`) so its logic is unit-testable even though the actual loop that runs live is generated JS text.

**Tech Stack:** bun + TypeScript, zero new npm runtime dependencies. `ego-browser` CLI (external, already required) drives the real scroll/DOM interaction.

## Global Constraints

- Zero new npm runtime dependencies (`bun` + `node:child_process` only — unchanged).
- No new user-facing CLI flags beyond removing `--page`. `--limit` gains a second meaning (also drives how far scrolling goes) but keeps its existing name and default (`undefined` = use the built-in default target).
- Scroll parameters are fixed internal constants, not flags: step `1400`px, wait `1.2`s between steps, stop after `3` consecutive no-growth steps, hard safety ceiling `12` steps, default target (when `--limit` omitted) `45`.
- Don't touch `detail.ts`/the `detail` command, and don't touch any sibling `.agents/skills/*-search` directory.
- Follow this repo's existing test convention: pure-function tests live in `cli/tests/parsing.test.ts`; CLI-process integration tests live in `cli/tests/cli-flag-validation.test.ts`.

---

### Task 1: Add the scroll stop-decision logic (pure, unit-tested)

**Files:**
- Modify: `.agents/skills/zhipin-search/cli/src/commands/search.ts` (insert after line 31, the end of the `RawCard` interface)
- Modify: `.agents/skills/zhipin-search/cli/tests/parsing.test.ts` (import line 10; new `describe` block)

**Interfaces:**
- Produces (consumed by Task 2): `ScrollState` interface `{ count: number; target: number; noGrowthStreak: number; steps: number }`, `shouldStopScrolling(state: ScrollState): boolean`, and exported constants `DEFAULT_TARGET_RESULTS = 45`, `MAX_SCROLL_STEPS = 12`, `NO_GROWTH_STOP_THRESHOLD = 3`, `SCROLL_STEP_PX = 1400`, `SCROLL_WAIT_SECONDS = 1.2` — all from `search.ts`.

- [ ] **Step 1: Write the failing test**

In `.agents/skills/zhipin-search/cli/tests/parsing.test.ts`, change line 10 from:

```ts
import { shapeResults, type RawCard } from "../src/commands/search";
```

to:

```ts
import {
  shapeResults,
  shouldStopScrolling,
  NO_GROWTH_STOP_THRESHOLD,
  MAX_SCROLL_STEPS,
  type RawCard,
} from "../src/commands/search";
```

Then add this new `describe` block anywhere after the existing `describe("shapeResults", ...)` block (i.e. after line 164, before `describe("shapeDetail", ...)`):

```ts
describe("shouldStopScrolling", () => {
  test("stops once the card count reaches the target", () => {
    expect(
      shouldStopScrolling({ count: 45, target: 45, noGrowthStreak: 0, steps: 3 }),
    ).toBe(true);
  });

  test("stops after the no-growth streak crosses the threshold", () => {
    expect(
      shouldStopScrolling({
        count: 15,
        target: 90,
        noGrowthStreak: NO_GROWTH_STOP_THRESHOLD,
        steps: 2,
      }),
    ).toBe(true);
  });

  test("stops once the safety ceiling of scroll steps is hit", () => {
    expect(
      shouldStopScrolling({ count: 30, target: 90, noGrowthStreak: 0, steps: MAX_SCROLL_STEPS }),
    ).toBe(true);
  });

  test("keeps scrolling when none of the stop conditions are met", () => {
    expect(
      shouldStopScrolling({ count: 15, target: 45, noGrowthStreak: 1, steps: 2 }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd .agents/skills/zhipin-search/cli
bun test tests/parsing.test.ts
```

Expected: FAIL — `shouldStopScrolling`, `NO_GROWTH_STOP_THRESHOLD`, `MAX_SCROLL_STEPS` are not exported from `../src/commands/search` (module has no such exports / TypeScript error).

- [ ] **Step 3: Implement the minimal code to make the test pass**

In `.agents/skills/zhipin-search/cli/src/commands/search.ts`, change:

```ts
export interface RawCard {
  href: string | null
  title: string | null
  company: string | null
  companyHref: string | null
  location: string | null
  salaryRaw: string | null
  experience: string | null
  education: string | null
}

// Verified selectors (li.job-card-box) — see url-reference.md for how these were
```

to:

```ts
export interface RawCard {
  href: string | null
  title: string | null
  company: string | null
  companyHref: string | null
  location: string | null
  salaryRaw: string | null
  experience: string | null
  education: string | null
}

// Scroll-loop tuning. BOSS直聘's result list loads in fixed +15-card batches;
// live spike testing (see docs/superpowers/specs/2026-07-14-zhipin-search-scroll-pagination-design.md)
// found real growth never produces more than 1 consecutive flat step, so 3 is a
// safe margin for "genuinely done." Kept as fixed constants (not flags) — this
// tool is personal, low-volume use only, not meant to become a deep crawler.
export const DEFAULT_TARGET_RESULTS = 45
export const MAX_SCROLL_STEPS = 12
export const NO_GROWTH_STOP_THRESHOLD = 3
export const SCROLL_STEP_PX = 1400
export const SCROLL_WAIT_SECONDS = 1.2

export interface ScrollState {
  count: number
  target: number
  noGrowthStreak: number
  steps: number
}

/** Pure: decide whether the scroll loop should stop after observing this step's card count. */
export function shouldStopScrolling(state: ScrollState): boolean {
  if (state.count >= state.target) return true
  if (state.noGrowthStreak >= NO_GROWTH_STOP_THRESHOLD) return true
  if (state.steps >= MAX_SCROLL_STEPS) return true
  return false
}

// Verified selectors (li.job-card-box) — see url-reference.md for how these were
```

(the trailing comment line is unchanged — reproduced only so the edit's anchor stays contiguous with the untouched code that follows it)

- [ ] **Step 4: Run the test and verify it passes**

```bash
cd .agents/skills/zhipin-search/cli
bun test tests/parsing.test.ts
```

Expected: PASS — all 4 new `shouldStopScrolling` tests green, plus all pre-existing tests in the file still green.

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/zhipin-search/cli/src/commands/search.ts .agents/skills/zhipin-search/cli/tests/parsing.test.ts
git commit -m "feat(zhipin-search): add pure shouldStopScrolling decision function"
```

---

### Task 2: Wire the scroll loop into buildBrowserScript, and remove the dead --page flag

**Files:**
- Modify: `.agents/skills/zhipin-search/cli/src/commands/search.ts:13-19` (`SearchOpts`), `:58-65` (`buildBrowserScript`), `:114-150` (`runSearch`)
- Modify: `.agents/skills/zhipin-search/cli/src/cli.ts:44-78` (`HELP`), `:103-132` (flag parsing / `SearchOpts` construction)
- Modify: `.agents/skills/zhipin-search/cli/tests/parsing.test.ts` (new `buildBrowserScript` test)
- Modify: `.agents/skills/zhipin-search/cli/tests/cli-flag-validation.test.ts:38-67` (`--page` tests)

**Interfaces:**
- Consumes (from Task 1): `shouldStopScrolling`, `ScrollState`, `DEFAULT_TARGET_RESULTS`, `MAX_SCROLL_STEPS`, `NO_GROWTH_STOP_THRESHOLD`, `SCROLL_STEP_PX`, `SCROLL_WAIT_SECONDS` — the loop generated as JS text mirrors the same threshold values (they're interpolated as literals into the generated script, not re-derived, so both stay in sync by construction).
- Produces (consumed by Task 3 docs, Task 4 verification): `buildBrowserScript(searchUrl: string, target: number): string`; `SearchOpts` without `page`; CLI no longer accepts `--page`.

- [ ] **Step 1: Write the failing test for `buildBrowserScript`**

In `.agents/skills/zhipin-search/cli/tests/parsing.test.ts`, extend the import from Task 1 to also pull in `buildBrowserScript`:

```ts
import {
  shapeResults,
  shouldStopScrolling,
  buildBrowserScript,
  NO_GROWTH_STOP_THRESHOLD,
  MAX_SCROLL_STEPS,
  type RawCard,
} from "../src/commands/search";
```

Add this `describe` block near the `shouldStopScrolling` block added in Task 1:

```ts
describe("buildBrowserScript", () => {
  test("embeds the scroll target and step parameters in the generated script", () => {
    const script = buildBrowserScript(
      "https://www.zhipin.com/web/geek/job?query=FDE&city=101020100",
      45,
    );
    expect(script).toContain("scrollBy(1400)");
    expect(script).toContain("wait(1.2)");
    expect(script).toContain("count < 45");
    expect(script).toContain(`steps < ${MAX_SCROLL_STEPS}`);
    expect(script).toContain(`noGrowthStreak < ${NO_GROWTH_STOP_THRESHOLD}`);
    expect(script).toContain("cliLog(JSON.stringify(results))");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd .agents/skills/zhipin-search/cli
bun test tests/parsing.test.ts
```

Expected: FAIL — `buildBrowserScript("<url>", 45)` still only takes one argument and doesn't emit a scroll loop, so `toContain("count < 45")` etc. fail.

- [ ] **Step 3: Implement — update `buildBrowserScript` and `SearchOpts` in search.ts**

In `.agents/skills/zhipin-search/cli/src/commands/search.ts`, change the `SearchOpts` interface (current lines 13-19) from:

```ts
export interface SearchOpts {
  query?: string
  location: string
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}
```

to:

```ts
export interface SearchOpts {
  query?: string
  location: string
  limit?: number
  format: "json" | "table" | "plain"
}
```

Then replace the existing `buildBrowserScript` function (current lines 58-65):

```ts
export function buildBrowserScript(searchUrl: string): string {
  return [
    `await gotoAndWait(${JSON.stringify(searchUrl)}, { timeout: 25, settle: 2 })`,
    `await wait(1)`,
    `const results = await js(${JSON.stringify(DOM_SCRIPT)})`,
    `cliLog(JSON.stringify(results))`,
  ].join("\n")
}
```

with:

```ts
const COUNT_CARDS_SCRIPT = `document.querySelectorAll('li.job-card-box').length`

export function buildBrowserScript(searchUrl: string, target: number): string {
  return [
    `await gotoAndWait(${JSON.stringify(searchUrl)}, { timeout: 25, settle: 2 })`,
    `await wait(1)`,
    `let count = await js(${JSON.stringify(COUNT_CARDS_SCRIPT)})`,
    `let noGrowthStreak = 0`,
    `let steps = 0`,
    `while (count < ${target} && noGrowthStreak < ${NO_GROWTH_STOP_THRESHOLD} && steps < ${MAX_SCROLL_STEPS}) {`,
    `  await scrollBy(${SCROLL_STEP_PX})`,
    `  await wait(${SCROLL_WAIT_SECONDS})`,
    `  const newCount = await js(${JSON.stringify(COUNT_CARDS_SCRIPT)})`,
    `  noGrowthStreak = newCount > count ? 0 : noGrowthStreak + 1`,
    `  count = newCount`,
    `  steps++`,
    `}`,
    `const results = await js(${JSON.stringify(DOM_SCRIPT)})`,
    `cliLog(JSON.stringify(results))`,
  ].join("\n")
}
```

Then in `runSearch` (current lines 114-150), change:

```ts
  try {
    const url = buildSearchUrl(opts.query || "", cityCode)
    const stdout = await runEgoBrowser(buildBrowserScript(url))
    const raw = lastJson<RawCard[]>(stdout)
    const cards = shapeResults(raw, opts.limit)
```

to:

```ts
  try {
    const url = buildSearchUrl(opts.query || "", cityCode)
    const target = opts.limit ?? DEFAULT_TARGET_RESULTS
    const stdout = await runEgoBrowser(buildBrowserScript(url, target))
    const raw = lastJson<RawCard[]>(stdout)
    const cards = shapeResults(raw, opts.limit)
```

And change the JSON-format output branch from:

```ts
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page }, results: cards }, null, 2) + "\n",
      )
    }
```

to:

```ts
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length }, results: cards }, null, 2) + "\n",
      )
    }
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
cd .agents/skills/zhipin-search/cli
bun test tests/parsing.test.ts
```

Expected: PASS for the new `buildBrowserScript` test. The rest of the suite (including `cli-flag-validation.test.ts`) will still FAIL at this point — `cli.ts` still references `flags.page`/`opts.page` against a `SearchOpts` that no longer has `page`. That's expected; fixed in the next steps.

- [ ] **Step 5: Update the flag-validation tests for `--page` removal**

In `.agents/skills/zhipin-search/cli/tests/cli-flag-validation.test.ts`, delete this whole block (current lines 38-46):

```ts
  describe("--page NaN validation", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--page", "abc"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/page/);
    });
  });

```

And change the "valid flags" test (current lines 58-67) from:

```ts
  describe("valid flags", () => {
    test("known city name + numeric page/limit produce no BAD_ARG/BAD_LOCATION", async () => {
      const result = await runCLI([
        "search", "-l", LOCATION, "--page", "1", "--limit", "5",
      ]);
      const err = parsedStderr(result.stderr);
      expect(err.code).not.toBe("BAD_ARG");
      expect(err.code).not.toBe("BAD_LOCATION");
      expect(err.code).not.toBe("NO_LOCATION");
    });
  });
```

to:

```ts
  describe("valid flags", () => {
    test("known city name + numeric limit produce no BAD_ARG/BAD_LOCATION", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--limit", "5"]);
      const err = parsedStderr(result.stderr);
      expect(err.code).not.toBe("BAD_ARG");
      expect(err.code).not.toBe("BAD_LOCATION");
      expect(err.code).not.toBe("NO_LOCATION");
    });
  });
```

- [ ] **Step 6: Implement — remove `--page` from cli.ts**

In `.agents/skills/zhipin-search/cli/src/cli.ts`, change the `HELP` text block from:

```ts
  --query, -q <text>      Keywords (job title, skill, or role). Recommended.
  --page <n>              1-indexed page. Default 1. NOTE: not yet wired up — the
                          geek search list showed no visible pagination beyond the
                          first result batch during investigation. Accepted for
                          contract-compatibility; currently has no effect.
  --limit, -n <n>         Cap results emitted (client-side).
```

to:

```ts
  --query, -q <text>      Keywords (job title, skill, or role). Recommended.
  --limit, -n <n>         Cap results emitted, and how far \`search\` scrolls to
                          find them: it scrolls the results list until at least
                          this many cards have loaded (bounded by a low, fixed
                          safety ceiling). Omit to use a conservative default
                          scroll target (45 cards) instead of just the first
                          screenful.
```

Then remove the page-parsing block. Change:

```ts
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      flags.page = String(v)
    }
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(v)
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
```

to:

```ts
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(v)
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
```

- [ ] **Step 7: Run the full test suite and verify it passes**

```bash
cd .agents/skills/zhipin-search/cli
bun test
```

Expected: PASS — every test in `parsing.test.ts` and `cli-flag-validation.test.ts` green, no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add .agents/skills/zhipin-search/cli/src/commands/search.ts .agents/skills/zhipin-search/cli/src/cli.ts .agents/skills/zhipin-search/cli/tests/parsing.test.ts .agents/skills/zhipin-search/cli/tests/cli-flag-validation.test.ts
git commit -m "feat(zhipin-search): scroll for more results, remove dead --page flag"
```

---

### Task 3: Update SKILL.md and cli/README.md

**Files:**
- Modify: `.agents/skills/zhipin-search/SKILL.md` (Key flags list, "Not supported" line)
- Modify: `.agents/skills/zhipin-search/cli/README.md` (Search flags table)

**Interfaces:**
- Consumes: the finalized `--limit`/scroll behavior and constants from Task 2 (target 45 default, scroll ceiling 12 steps) — purely descriptive, no code interface.

This task is documentation only — no test to write/run. Verify by rereading the changed sections after editing.

- [ ] **Step 1: Update SKILL.md**

In `.agents/skills/zhipin-search/SKILL.md`, change:

```markdown
Key flags:
- `--location <city>` / `-l <city>` — **required.** A verified city name/alias (上海,
  北京, 杭州, 苏州, or `shanghai`/`beijing`/`hangzhou`/`suzhou`) or a raw 9-digit
  BOSS直聘 city code. See `url-reference.md` for how to verify and add a new one.
- `--query <text>` / `-q <text>` — keyword search (title, skill, role). Recommended.
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

**Salary is not available from `search`** — BOSS直聘 masks it in the list view
(returns `null`); use `detail` for the real figure. Not supported: `--jobage`
(no posting-date filter/field exists on this portal), `--page` (accepted but not
wired up — no pagination was observed in the geek search list).
```

to:

```markdown
Key flags:
- `--location <city>` / `-l <city>` — **required.** A verified city name/alias (上海,
  北京, 杭州, 苏州, or `shanghai`/`beijing`/`hangzhou`/`suzhou`) or a raw 9-digit
  BOSS直聘 city code. See `url-reference.md` for how to verify and add a new one.
- `--query <text>` / `-q <text>` — keyword search (title, skill, role). Recommended.
- `--limit <n>` / `-n <n>` — cap total results emitted, **and how far `search` scrolls to find them**: it
  scrolls the results list until at least this many cards have loaded, up to a fixed safety ceiling. Omit to
  use a conservative default scroll target (45 cards) instead of just the first screenful.
- `--format json|table|plain` — default `json`.

**Salary is not available from `search`** — BOSS直聘 masks it in the list view
(returns `null`); use `detail` for the real figure. Not supported: `--jobage`
(no posting-date filter/field exists on this portal).

**Pagination is scroll-driven, not a flag.** BOSS直聘's result list is infinite-scroll, not
page-numbered — an earlier `--page` flag never did anything and has been removed. `search` now
scrolls automatically (bounded — a handful of steps, not a deep crawl, matching this skill's
personal-use-only posture) before scraping.
```

- [ ] **Step 2: Update cli/README.md**

In `.agents/skills/zhipin-search/cli/README.md`, change the "Search flags" table from:

```markdown
## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--location` | `-l` | **Required.** A verified city name/alias (上海, 北京, 杭州, 苏州, or shanghai/beijing/hangzhou/suzhou) or a raw 9-digit city code. |
| `--query` | `-q` | Keywords (title / skill / role). Recommended. |
| `--page` | | Accepted, not yet wired up (no pagination observed in the geek search list). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

Not supported: `--jobage` (no posting-date filter or field exists in this portal's UI),
`--remote` (no workplace-type filter observed).
```

to:

```markdown
## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--location` | `-l` | **Required.** A verified city name/alias (上海, 北京, 杭州, 苏州, or shanghai/beijing/hangzhou/suzhou) or a raw 9-digit BOSS直聘 city code. |
| `--query` | `-q` | Keywords (title / skill / role). Recommended. |
| `--limit` | `-n` | Cap results emitted, and how far `search` scrolls to find them (see below). |
| `--format` | | `json` \| `table` \| `plain`. |

Not supported: `--jobage` (no posting-date filter or field exists in this portal's UI),
`--remote` (no workplace-type filter observed).

**Scroll-driven pagination.** BOSS直聘's result list is infinite-scroll, not page-numbered
(an earlier `--page` flag never worked and has been removed). `search` scrolls the page,
in bounded steps, until either `--limit` cards have loaded, the list stops growing, or a
low fixed step ceiling is hit — never an unbounded crawl, matching this skill's
personal, low-volume use only posture. Omit `--limit` to use a default scroll target of
45 cards.
```

- [ ] **Step 3: Commit**

```bash
git add .agents/skills/zhipin-search/SKILL.md .agents/skills/zhipin-search/cli/README.md
git commit -m "docs(zhipin-search): describe scroll-driven pagination, drop --page mentions"
```

---

### Task 4: Install, run the full suite, and verify live against zhipin.com

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: a verified, working `search` command — the deliverable of this whole plan.

- [ ] **Step 1: Install dependencies**

```bash
cd .agents/skills/zhipin-search/cli
bun install
```

Expected: completes without error (installs TypeScript dev types only, per this skill's zero-npm-runtime-deps design — `node_modules` is gitignored, this is regenerating it in the worktree).

- [ ] **Step 2: Run the full automated test suite**

```bash
cd .agents/skills/zhipin-search/cli
bun test
```

Expected: PASS — every test across `parsing.test.ts` and `cli-flag-validation.test.ts` green.

- [ ] **Step 3: Live end-to-end verification — default target**

Requires Chrome running with an active, logged-in BOSS直聘 session (already the case in this environment).

```bash
cd .agents/skills/zhipin-search/cli
bun run src/cli.ts search -q "FDE" -l "上海" --format table
```

Expected: more than 15 rows in the output table — the documented baseline before this fix was exactly 15; the default scroll target is 45, so expect somewhere around 45 results (it may land a little under if the query's real ceiling is below 45, or stop early at a batch boundary at/above 45 — either is correct; what must NOT happen is exactly 15).

- [ ] **Step 4: Live end-to-end verification — explicit `--limit` drives further scrolling**

```bash
cd .agents/skills/zhipin-search/cli
bun run src/cli.ts search -q "FDE" -l "上海" --limit 60 --format table
```

Expected: more results than Step 3's run (targeting 60 instead of the default 45), demonstrating `--limit` actually changes how far the tool scrolls — not just how many of an already-fixed set it slices.

- [ ] **Step 5: Report results**

No commit for this task (verification only). Summarize in your final report to the user: automated test pass/fail, and the exact row counts from Steps 3 and 4 compared against the 15-row baseline.
