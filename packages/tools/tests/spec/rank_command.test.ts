/** Guards for the /rank command spec. Port of tests/test_rank_command.py.
 * The .claude/settings.json allowlist test is obsolete after the pi
 * migration (pi settings carry no permissions.allow). */
import { describe, expect, test } from "bun:test";
import { WORKFLOWS, SKILLS, read, sections , PROFILE, FACTORY } from "./helpers.ts";

const COMMAND = `${WORKFLOWS}/02-rank.md`;
const SCRAPER_SKILL = `${SKILLS}/job-scraper/SKILL.md`;
const EVALUATION = `${PROFILE}/04-job-evaluation.md`;

const RANK_STATE = "bun run packages/tools/src/cli.ts rank-state";

function flatten(s: string): string {
  return s.split(/\s+/).join(" ");
}

describe("/rank command spec", () => {
  test("file exists with lint-compliant header", () => {
    expect(read(COMMAND).split("\n")[0]).toMatch(/^# \/rank/);
  });

  test("step4 persists gaps and strengths", () => {
    const step4 = sections(read(COMMAND))["Step 4: Update State"] ?? "";
    expect(step4).toContain('"gaps"');
    expect(step4).toContain('"strengths"');
  });

  test("step4 documents verbatim/no-accumulate/untrusted-data rules", () => {
    const step4 = sections(read(COMMAND))["Step 4: Update State"] ?? "";
    expect(step4).toContain("verbatim");
    expect(step4).toContain("replaces");
    expect(step4).toContain("untrusted data");
  });

  test("important rules link honest scoring to persistence", () => {
    const rules = sections(read(COMMAND))["Important Rules"] ?? "";
    expect(rules).toContain("persisted with it");
  });

  test("job-scraper schema note mentions strengths and gaps", () => {
    const text = read(SCRAPER_SKILL);
    expect(text).toContain("strengths");
    expect(text).toContain("gaps");
    expect(text).toContain("readers tolerate their absence");
  });

  test("job-scraper schema carries deadline", () => {
    const text = read(SCRAPER_SKILL);
    expect(text).toContain('"deadline": "YYYY-MM-DD" | null');
    expect(text).toContain("never infer a deadline");
    expect(text).toContain("base field rather than a `/rank` extension");
  });

  test("verdict written to location_verdict, not bare location", () => {
    const text = read(COMMAND);
    expect(text).toContain('"location_verdict"');
    expect(text).toContain('"location_verdict": "PASS"/"FAIL"/"FLAG"');
    expect(text).not.toContain('"location":');
    expect(text).toContain("legacy");
  });

  test("job-scraper schema note enumerates the veto fields", () => {
    const text = read(SCRAPER_SKILL);
    for (const field of ["location_verdict", "language_gate", "language_note"]) {
      expect(text).toContain(field);
    }
  });

  test("evaluation framework acknowledges language gate tracking", () => {
    const text = read(EVALUATION);
    const gate = text.split("## Language Gate")[1]?.split("\n## ")[0] ?? "";
    expect(gate.length).toBeGreaterThan(0);
    expect(gate).toContain("language_gate");
    expect(gate).toContain("language_note");
    expect(gate).not.toContain("not a field");
  });

  test("sweep parses stored deadlines defensively", () => {
    const text = read(COMMAND);
    expect(text).toContain("Parse stored deadlines defensively");
    expect(flatten(text)).toMatch(
      /not a `YYYY-MM-DD` date[^.]*treated exactly like an absent one/,
    );
  });

  test("step2 schema includes language gate fields", () => {
    const step2 = sections(read(COMMAND))["Step 2: Batch-Fetch and Score"] ?? "";
    expect(step2).toContain('"language_gate"');
    expect(step2).toContain('"language_note"');
    expect(step2).toContain('"PASS" | "FAIL" | "FLAG"');
    expect(step2).toContain("distinct from");
  });

  test("step3 documents language veto", () => {
    const step3 = sections(read(COMMAND))["Step 3: Aggregate and Rank"] ?? "";
    expect(step3).toContain("Language veto");
    expect(step3).toContain("excludes the job from the shortlist");
  });

  test("step4 persists language gate and note", () => {
    const step4 = sections(read(COMMAND))["Step 4: Update State"] ?? "";
    expect(step4).toContain('"language_gate"');
    expect(step4).toContain('"language_note"');
    expect(step4).toContain("as important to persist as the score itself");
  });

  test("step4 persists deadline", () => {
    const step4 = sections(read(COMMAND))["Step 4: Update State"] ?? "";
    expect(step4).toContain('"deadline"');
    expect(step4).toContain("from the same Step 2 JSON");
    expect(step4).toContain("absence is not a correction");
  });

  test("step3 reads stored deadline without fetch", () => {
    const step3 = sections(read(COMMAND))["Step 3: Aggregate and Rank"] ?? "";
    expect(step3).toContain("stored `deadline`");
    expect(step3).toContain("costs no fetch");
  });

  test("step3 documents expiry sweep over ranked entries", () => {
    const s = sections(read(COMMAND));
    const step3 = s["Step 3: Aggregate and Rank"] ?? "";
    expect(step3).toContain("Expiry sweep");
    expect(step3).toContain("date comparison against values already on disk");
    expect(s["Job Ranking - YYYY-MM-DD"] ?? "").toContain("Closing soon");
  });

  test("step3 sweep states its two boundary rules", () => {
    const step3 = sections(read(COMMAND))["Step 3: Aggregate and Rank"] ?? "";
    expect(step3).toContain("never guessed at");
    expect(step3).toContain("revived by a later `--all`");
  });

  test("step4 sweep is named as the exception to idempotency", () => {
    const step4 = sections(read(COMMAND))["Step 4: Update State"] ?? "";
    expect(step4).toContain("deliberate exception");
  });

  test("step4 null deadline rule states its interlock with the sweep", () => {
    const step4 = sections(read(COMMAND))["Step 4: Update State"] ?? "";
    expect(step4).toContain("immortal to the sweep");
  });

  test("step5 reports the sweep counts", () => {
    const step5 = sections(read(COMMAND))["Job Ranking - YYYY-MM-DD"] ?? "";
    expect(step5).toContain("Swept");
  });

  test("step4 persists the sweep's expiry", () => {
    const step4 = sections(read(COMMAND))["Step 4: Update State"] ?? "";
    expect(step4).toContain("retired by Step 3's rule 6 sweep");
  });

  test("step5 documents language flag marker", () => {
    const step5 = sections(read(COMMAND))["Job Ranking - YYYY-MM-DD"] ?? "";
    expect(step5).toContain("language_gate: FLAG");
  });
});

describe("posted-date staleness spec", () => {
  const step3 = () => sections(read(COMMAND))["Step 3: Aggregate and Rank"] ?? "";

  test("step3 consumes posted_date", () => {
    const s = step3();
    expect(s).toContain("`posted_date`");
    expect(s.split("`posted_date`")[1]!.slice(0, 600)).toContain("⚠");
  });

  test("staleness is a flag never a veto", () => {
    expect(flatten(step3())).toMatch(/[Aa]ge is a signal, never a veto/);
  });

  test("staleness never inferred for absent values", () => {
    expect(flatten(step3())).toMatch(/no `posted_date`.*no flag and no guess/);
    expect(step3()).toContain("`first_seen`");
  });

  test("staleness parses posted_date defensively", () => {
    expect(flatten(step3())).toMatch(
      /defensive-parse rule applies wherever a stored `posted_date` is compared/,
    );
  });
});

describe("rank batch limit spec", () => {
  test("step0 documents default limit distinct from top", () => {
    const step0 = sections(read(COMMAND))["Step 0: Parse Input"] ?? "";
    expect(step0).toContain("`--limit <N>`");
    expect(step0).toContain("default 10");
    expect(step0).toContain("`--top <N>`");
    expect(step0).toContain("They are independent");
  });

  test("step1 applies limit via the state tool", () => {
    const step1 = sections(read(COMMAND))["Step 1: Load State"] ?? "";
    expect(step1).toContain(`${RANK_STATE} candidates --limit 10`);
    expect(step1).toContain("deferred");
  });

  test("step5 reports deferral and how to continue", () => {
    const report = sections(read(COMMAND))["Job Ranking - YYYY-MM-DD"] ?? "";
    expect(report).toContain("jobs deferred");
    expect(report).toContain("re-run `/rank` to continue");
  });
});

describe("rank-state tool routing", () => {
  function step2ResultFields(): string[] {
    const step2 = sections(read(COMMAND))["Step 2: Batch-Fetch and Score"] ?? "";
    const block = step2.split("```json")[1]?.split("```")[0] ?? "";
    const fields = [...block.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]!);
    expect(fields.length).toBeGreaterThan(0);
    return fields;
  }

  test("step1 never reads the state file manually", () => {
    const step1 = sections(read(COMMAND))["Step 1: Load State"] ?? "";
    expect(step1).toContain("Never read `state/seen_jobs.json` into the conversation");
    expect(step1).toContain(`${RANK_STATE} candidates`);
  });

  test("step4 writes back through the tool, not by hand", () => {
    const step4 = sections(read(COMMAND))["Step 4: Update State"] ?? "";
    expect(step4).toContain(`${RANK_STATE} apply`);
    expect(step4).toContain("never re-read to build it");
  });

  test("step4 preserves every field step2 declares", () => {
    const step4 = sections(read(COMMAND))["Step 4: Update State"] ?? "";
    const notPersistedVerbatim = new Set([
      "key", "status", "language", "scores", "technical", "experience", "behavioral", "career",
    ]);
    const mustPersist = step2ResultFields().filter((f) => !notPersistedVerbatim.has(f));
    const missing = mustPersist.filter((f) => !step4.includes(`"${f}"`));
    expect(missing).toEqual([]);
  });

  test("step4 documents the location verdict legacy migration", () => {
    const step4 = sections(read(COMMAND))["Step 4: Update State"] ?? "";
    expect(step4).toContain("never the bare `location` key");
    expect(step4).toContain("legacy");
  });

  test("step4 documents deadline null is not a correction", () => {
    const step4 = sections(read(COMMAND))["Step 4: Update State"] ?? "";
    expect(step4).toContain("absence is not a correction");
  });

  test("step3 sweep runs through the tool", () => {
    const step3 = sections(read(COMMAND))["Step 3: Aggregate and Rank"] ?? "";
    expect(step3).toContain(`${RANK_STATE} sweep`);
  });

  test("tracker stays read-only", () => {
    const step4 = sections(read(COMMAND))["Step 4: Update State"] ?? "";
    expect(step4).toContain("never applies");
  });
});
