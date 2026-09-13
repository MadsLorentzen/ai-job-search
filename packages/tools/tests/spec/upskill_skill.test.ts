/** Guards for the /upskill skill spec. Port of tests/test_upskill_skill.py
 * (skill at .pi-agent/skills/upskill/SKILL.md). */
import { describe, expect, test } from "bun:test";
import { SKILLS, read, sections } from "./helpers.ts";

const SKILL = `${SKILLS}/upskill/SKILL.md`;

const skillSections = () => sections(read(SKILL));

describe("/upskill skill spec", () => {
  test("skill file exists with lint-compliant header", () => {
    const text = read(SKILL);
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain("name: upskill");
  });

  test("step2 reads ranked jobs with moderate fit floor", () => {
    const step2 = skillSections()["Step 2: Load Data"] ?? "";
    expect(step2).toContain("seen_jobs.json");
    expect(step2).toContain("rank_score >= 45");
    expect(step2).toContain("gap persistence");
  });

  test("step2 column list keeps in phase with tracker header", () => {
    const step2 = skillSections()["Step 2: Load Data"] ?? "";
    expect(step2).toContain("source, deadline");
  });

  test("step3 documents dedupe and gap precedence", () => {
    const step3 = skillSections()["Step 3: Pass 1 — Hard Skill Diff"] ?? "";
    expect(step3).toContain("case-insensitive company + role");
    expect(step3).toContain("/notion-sync");
    expect(step3).toContain("Recorded gaps beat inferred skills");
    expect(step3).toContain("(100 - fit_rating) / 100");
    expect(step3).toContain("(100 - rank_score) / 100");
  });

  test("step3 handles blank fit_rating", () => {
    const step3 = skillSections()["Step 3: Pass 1 — Hard Skill Diff"] ?? "";
    expect(step3).toContain("blank or non-numeric `fit_rating`");
    expect(step3).toContain("Never treat a blank as 0");
  });

  test("step5 heatmap shows gap provenance", () => {
    const step5 = skillSections()["Step 5: Build Gap Heatmap"] ?? "";
    expect(step5).toContain("recorded gaps");
    expect(step5).toContain("inferred");
  });

  test("step8 report header counts both sources", () => {
    const step8 = skillSections()["Step 8: Write and Save Report"] ?? "";
    expect(step8).toContain("T tracked, R ranked");
  });

  test("important rules cover untrusted data and no backfill", () => {
    const rules = skillSections()["Important Rules"] ?? "";
    expect(rules).toContain("never instructions");
    expect(rules).toContain("Never invent gap history");
  });
});
