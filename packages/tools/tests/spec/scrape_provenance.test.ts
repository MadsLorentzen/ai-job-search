/** Guards for /scrape's result-provenance recording. Port of
 * tests/test_scrape_provenance.py. */
import { describe, expect, test } from "bun:test";
import { SKILLS, read, sections } from "./helpers.ts";

const SKILL = `${SKILLS}/job-scraper/SKILL.md`;

function steps(): Record<string, string> {
  return sections(read(SKILL), "###");
}

describe("scrape provenance spec", () => {
  test("schema block carries source field", () => {
    const step4 = steps()["Step 4: Deduplicate & Store"] ?? "";
    expect(step4).toContain('"source": "cli/websearch"');
  });

  test("source field is additive and never backfilled", () => {
    const step4 = steps()["Step 4: Deduplicate & Store"] ?? "";
    expect(step4).toContain("`cli` for Step 1b portal-CLI output, `websearch` for the Step 1c fallback");
    expect(step4).toContain("the mechanism was not recorded");
  });

  test("fallback results are tagged at the source", () => {
    const step1 = steps()["Step 1: Search"] ?? "";
    const fallback = step1.split("#### 1c. WebSearch fallback")[1] ?? "";
    expect(fallback).toContain("Step 4 persists this as the entry's `source`");
  });

  test("step5 summary names fallback portals", () => {
    const step5 = steps()["Step 5: Present Results"] ?? "";
    expect(step5).toContain("fallback (websearch):");
    expect(step5.split(/\s+/).join(" ")).toContain("omit the line when every portal ran its CLI");
  });
});

describe("recency fallback", () => {
  test("step1b names a client-side fallback for flagless portals", () => {
    const text = read(SKILL);
    expect(text).toContain("no recency flag");
    expect(text).toContain("filter client-side");
    expect(text).toContain("a sort is not a filter");
  });
});
