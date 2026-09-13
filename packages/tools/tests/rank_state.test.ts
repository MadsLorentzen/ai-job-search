/** Port of tests/test_rank_state.py - /rank's state helper (#395). */
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "./helpers.ts";

const TODAY = "2026-09-03";

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "SOC Analyst",
    company: "Acme",
    url: "https://example.com/job",
    first_seen: "2026-08-30",
    deadline: null,
    status: "new",
    portal: "linkedin-search",
    ...over,
  };
}

let tmp: string;
let statePath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "rank_state_"));
  statePath = join(tmp, "seen_jobs.json");
});

function writeState(seen: Record<string, unknown>) {
  Bun.write(statePath, JSON.stringify({ seen }));
}

function runTool(args: string[], expect: number = 0) {
  const proc = runCli(["rank-state", ...args, "--state", statePath, "--today", TODAY]);
  if (proc.exitCode !== expect) {
    throw new Error(`exit ${proc.exitCode} (expected ${expect}): ${proc.stderr}`);
  }
  return JSON.parse(proc.stdout);
}

function readState(): Record<string, any> {
  return JSON.parse(readFileSync(statePath, "utf8")).seen;
}

const noneTracker = () => join(tmp, "none.csv");

describe("candidates", () => {
  test("selects only new entries and projects a compact row", () => {
    writeState({
      a: entry(),
      b: entry({ status: "ranked", rank_score: 70 }),
      c: entry({ status: "skipped" }),
      d: entry({ status: "expired" }),
    });
    const out = runTool(["candidates", "--tracker", noneTracker()]);
    expect(out.selected.map((r: any) => r.key)).toEqual(["a"]);
    expect(new Set(Object.keys(out.selected[0]))).toEqual(
      new Set(["key", "title", "company", "url", "portal", "deadline", "posted_date"]),
    );
  });

  test("limit defers the rest and reports the count", () => {
    writeState(Object.fromEntries([...Array(25).keys()].map((i) => [`k${i}`, entry({ title: `Role ${i}` })])));
    const out = runTool(["candidates", "--limit", "10", "--tracker", noneTracker()]);
    expect(out.selected.length).toBe(10);
    expect(out.eligible).toBe(25);
    expect(out.deferred).toBe(15);
  });

  test("limit zero means no cap", () => {
    writeState(Object.fromEntries([...Array(15).keys()].map((i) => [`k${i}`, entry({ title: `Role ${i}` })])));
    const out = runTool(["candidates", "--limit", "0", "--tracker", noneTracker()]);
    expect(out.selected.length).toBe(15);
    expect(out.deferred).toBe(0);
  });

  test("tracker pairs are excluded", () => {
    writeState({ a: entry({ company: "Acme", title: "SOC Analyst" }), b: entry({ company: "Other" }) });
    const tracker = join(tmp, "tracker.csv");
    Bun.write(tracker, "date,company,role\n2026-08-01,ACME,soc analyst\n");
    const out = runTool(["candidates", "--tracker", tracker]);
    expect(out.selected.map((r: any) => r.key)).toEqual(["b"]);
    expect(out.excluded_by_tracker).toBe(1);
  });

  test("focus filters on title, company and stored fit notes", () => {
    writeState({
      a: entry({ title: "Data Scientist" }),
      b: entry({ title: "SOC Analyst" }),
      c: entry({ title: "Engineer", strengths: ["strong data science match"] }),
    });
    const out = runTool(["candidates", "--focus", "data scien", "--tracker", noneTracker()]);
    expect(out.selected.map((r: any) => r.key).sort()).toEqual(["a", "c"]);
  });

  test("--all includes every status but skipped", () => {
    writeState({
      a: entry({ status: "ranked" }),
      b: entry({ status: "expired" }),
      c: entry({ status: "skipped" }),
      d: entry({ status: "new" }),
    });
    const out = runTool(["candidates", "--all", "--tracker", noneTracker()]);
    expect(out.selected.map((r: any) => r.key).sort()).toEqual(["a", "b", "d"]);
  });

  test("missing state file exits nonzero", () => {
    const proc = runCli([
      "rank-state",
      "candidates",
      "--state",
      join(tmp, "nope.json"),
      "--tracker",
      noneTracker(),
    ]);
    expect(proc.exitCode).not.toBe(0);
    expect(proc.stderr + proc.stdout).toContain("not found");
  });
});

describe("sweep", () => {
  test("retires past deadlines and flags the closing ones", () => {
    writeState({
      past: entry({ status: "ranked", deadline: "2026-09-01" }),
      soon: entry({ status: "ranked", deadline: "2026-09-07" }),
      later: entry({ status: "ranked", deadline: "2026-12-01" }),
    });
    const out = runTool(["sweep", "--write"]);
    expect(out.newly_expired.map((r: any) => r.key)).toEqual(["past"]);
    expect(out.closing_soon.map((r: any) => r.key)).toEqual(["soon"]);
    expect(readState().past.status).toBe("expired");
    expect(readState().soon.status).toBe("ranked");
  });

  test("entries without a deadline are left alone", () => {
    writeState({ a: entry({ status: "ranked", deadline: null }), b: entry({ status: "ranked" }) });
    const out = runTool(["sweep", "--write"]);
    expect(out.newly_expired).toEqual([]);
    expect(Object.values(readState()).every((e: any) => e.status === "ranked")).toBe(true);
  });

  test("non-iso deadlines are reported not compared", () => {
    writeState({
      asap: entry({ status: "ranked", deadline: "ASAP", portal: "jobindex-search" }),
      euro: entry({ status: "ranked", deadline: "31.08.2026", portal: "jobbank-search" }),
    });
    const out = runTool(["sweep", "--write"]);
    expect(out.newly_expired).toEqual([]);
    expect(out.unparseable_deadlines.map((r: any) => r.portal).sort()).toEqual([
      "jobbank-search",
      "jobindex-search",
    ]);
    expect(Object.values(readState()).every((e: any) => e.status === "ranked")).toBe(true);
  });

  test("only ranked entries are swept and excluded keys are skipped", () => {
    writeState({
      new_past: entry({ status: "new", deadline: "2026-09-01" }),
      rescored: entry({ status: "ranked", deadline: "2026-09-01" }),
      other: entry({ status: "ranked", deadline: "2026-09-01" }),
    });
    const out = runTool(["sweep", "--write", "--exclude", "rescored"]);
    expect(out.newly_expired.map((r: any) => r.key)).toEqual(["other"]);
    expect(out.swept).toBe(1);
    expect(readState().new_past.status).toBe("new");
  });

  test("without --write nothing is persisted", () => {
    writeState({ past: entry({ status: "ranked", deadline: "2026-09-01" }) });
    const out = runTool(["sweep"]);
    expect(out.newly_expired.map((r: any) => r.key)).toEqual(["past"]);
    expect(out.written).toBe(false);
    expect(readState().past.status).toBe("ranked");
  });
});

describe("apply", () => {
  const resultsPath = (payload: unknown) => {
    const p = join(tmp, "results.json");
    Bun.write(p, JSON.stringify(payload));
    return p;
  };

  test("weights, bands and persisted fields", () => {
    writeState({ a: entry() });
    const out = runTool([
      "apply",
      "--results",
      resultsPath([
        {
          key: "a",
          status: "scored",
          scores: { technical: 80, experience: 60, behavioral: 70, career: 75 },
          location_verdict: "PASS",
          language_gate: "PASS",
          deadline: "2026-09-05",
          strengths: ["s1", "s2"],
          gaps: ["g1"],
        },
      ]),
    ]);
    const stored = readState().a;
    // 80*.30 + 60*.25 + 70*.15 + 75*.30 = 72
    expect(stored.rank_score).toBe(72);
    expect(stored.rank_verdict).toBe("Good Fit");
    expect(stored.status).toBe("ranked");
    expect(stored.rank_date).toBe(TODAY);
    expect(stored.strengths).toEqual(["s1", "s2"]);
    expect(stored.gaps).toEqual(["g1"]);
    expect(stored.deadline).toBe("2026-09-05");
    expect(out.ranked[0].urgent).toBe(true);
  });

  test("expired status is written through", () => {
    writeState({ a: entry() });
    const out = runTool(["apply", "--results", resultsPath([{ key: "a", status: "expired" }])]);
    expect(readState().a.status).toBe("expired");
    expect(out.expired.map((r: any) => r.key)).toEqual(["a"]);
  });

  test("null deadline does not erase a stored one", () => {
    writeState({ a: entry({ deadline: "2026-10-01" }) });
    runTool([
      "apply",
      "--results",
      resultsPath([
        { key: "a", status: "scored", scores: { technical: 50, experience: 50, behavioral: 50, career: 50 }, deadline: null },
      ]),
    ]);
    expect(readState().a.deadline).toBe("2026-10-01");
  });

  test("legacy verdict stored under location is migrated", () => {
    writeState({ a: entry({ location: "FLAG" }) });
    runTool([
      "apply",
      "--results",
      resultsPath([{ key: "a", status: "scored", scores: { technical: 50, experience: 50, behavioral: 50, career: 50 } }]),
    ]);
    const stored = readState().a;
    expect(stored.location_verdict).toBe("FLAG");
    expect("location" in stored).toBe(false);
  });

  test("a real place in location survives", () => {
    writeState({ a: entry({ location: "Athens, Greece" }) });
    runTool([
      "apply",
      "--results",
      resultsPath([
        { key: "a", status: "scored", scores: { technical: 50, experience: 50, behavioral: 50, career: 50 }, location_verdict: "PASS" },
      ]),
    ]);
    expect(readState().a.location).toBe("Athens, Greece");
  });

  test("vetoed rows are separated from the ranking", () => {
    writeState({ a: entry(), b: entry(), c: entry() });
    const scores = { technical: 90, experience: 90, behavioral: 90, career: 90 };
    const out = runTool([
      "apply",
      "--results",
      resultsPath([
        { key: "a", status: "scored", scores, location_verdict: "FAIL" },
        { key: "b", status: "scored", scores, language_gate: "FAIL", language_note: "requires fluent Polish" },
        { key: "c", status: "scored", scores: { technical: 40, experience: 40, behavioral: 40, career: 40 } },
      ]),
    ]);
    expect(out.vetoed.map((r: any) => r.key).sort()).toEqual(["a", "b"]);
    expect(out.ranked.map((r: any) => r.key)).toEqual(["c"]);
    expect(readState().b.language_note).toBe("requires fluent Polish");
  });

  test("language note is dropped when gate passes", () => {
    writeState({ a: entry({ language_note: "stale note from a prior run" }) });
    runTool([
      "apply",
      "--results",
      resultsPath([
        { key: "a", status: "scored", scores: { technical: 50, experience: 50, behavioral: 50, career: 50 }, language_gate: "PASS" },
      ]),
    ]);
    expect("language_note" in readState().a).toBe(false);
  });

  test("strengths and gaps are capped and stored verbatim", () => {
    writeState({ a: entry() });
    runTool([
      "apply",
      "--results",
      resultsPath([
        {
          key: "a",
          status: "scored",
          scores: { technical: 50, experience: 50, behavioral: 50, career: 50 },
          strengths: ["one", "two", "three", "four"],
          gaps: ["<script>not sanitized on purpose, stored as plain data</script>"],
        },
      ]),
    ]);
    const stored = readState().a;
    expect(stored.strengths.length).toBe(3);
    expect(stored.gaps).toEqual(["<script>not sanitized on purpose, stored as plain data</script>"]);
  });

  test("apply replaces rather than accumulates arrays", () => {
    writeState({ a: entry({ status: "ranked", strengths: ["old strength"], gaps: ["old gap"] }) });
    runTool([
      "apply",
      "--results",
      resultsPath([
        { key: "a", status: "scored", scores: { technical: 50, experience: 50, behavioral: 50, career: 50 }, strengths: ["new strength"], gaps: ["new gap"] },
      ]),
    ]);
    const stored = readState().a;
    expect(stored.strengths).toEqual(["new strength"]);
    expect(stored.gaps).toEqual(["new gap"]);
  });

  test("unknown key is an error not a silent drop", () => {
    writeState({ a: entry() });
    const out = runTool(
      ["apply", "--results", resultsPath([{ key: "ghost", status: "scored", scores: {} }])],
      1,
    );
    expect(out.errors[0].key).toBe("ghost");
  });

  test("missing score dimension is an error", () => {
    writeState({ a: entry() });
    const out = runTool(
      ["apply", "--results", resultsPath([{ key: "a", status: "scored", scores: { technical: 80 } }])],
      1,
    );
    expect(out.errors[0].error).toContain("experience");
    expect(readState().a.status).toBe("new");
  });

  test("dry run prints but never writes", () => {
    writeState({ a: entry() });
    runTool([
      "apply",
      "--results",
      resultsPath([{ key: "a", status: "scored", scores: { technical: 50, experience: 50, behavioral: 50, career: 50 } }]),
      "--dry-run",
    ]);
    expect(readState().a.status).toBe("new");
  });

  test("re-scoring an already-ranked job is idempotent", () => {
    writeState({ a: entry({ status: "ranked", rank_score: 40, strengths: ["old"] }) });
    const scores = { technical: 90, experience: 90, behavioral: 90, career: 90 };
    runTool(["apply", "--results", resultsPath([{ key: "a", status: "scored", scores, strengths: ["new"] }])]);
    const stored = readState().a;
    expect(stored.rank_score).toBe(90);
    expect(stored.strengths).toEqual(["new"]);
  });
});
