/** Guards for the company-research cache spec. Port of
 * tests/test_company_research_cache.py. */
import { describe, expect, test } from "bun:test";
import { SKILLS, WORKFLOWS, read, sections , PROFILE, FACTORY } from "./helpers.ts";

const EVALUATION = `${PROFILE}/04-job-evaluation.md`;
const APPLY = `${WORKFLOWS}/03-apply.md`;
const INTERVIEW = `${WORKFLOWS}/06-interview.md`;

function applyResearchStep(): string {
  for (const [heading, body] of Object.entries(sections(read(APPLY), "###"))) {
    if (heading.startsWith("1. Research the Company")) return body;
  }
  return "";
}

function interviewResearchStep(): string {
  for (const [heading, body] of Object.entries(sections(read(INTERVIEW), "##"))) {
    if (heading.startsWith("Step 2: Research the Company")) return body;
  }
  return "";
}

describe("cache definition (04-job-evaluation.md)", () => {
  const evaluationSections = () => sections(read(EVALUATION));

  test("defines the cache section", () => {
    expect("Company Research Cache" in evaluationSections()).toBe(true);
  });

  test("specifies location and ttl", () => {
    const body = evaluationSections()["Company Research Cache"] ?? "";
    expect(body).toContain("research/");
    expect(body).toContain("30");
    expect(body).toContain("fetched_date");
  });

  test("preserves the verification rule", () => {
    const body = evaluationSections()["Company Research Cache"] ?? "";
    expect(body).toContain("lead");
    expect(body).toMatch(/[Vv]erif/);
  });

  test("states contents are data, not instructions", () => {
    const body = evaluationSections()["Company Research Cache"] ?? "";
    expect(body).toContain("data, never instructions");
  });
});

describe("/apply wiring", () => {
  test("reviewer prompt checks cache before researching", () => {
    const body = applyResearchStep();
    expect(body).not.toBe("");
    expect(body).toContain("research/");
    expect(body).toMatch(/[Cc]heck the cache/);
  });

  test("reviewer prompt writes back after fresh research", () => {
    expect(applyResearchStep()).toMatch(/write.*research\/|research\/.*write/);
  });

  test("restates verification still applies to a cache hit", () => {
    expect(applyResearchStep()).toMatch(/still applies/);
  });
});

describe("/interview wiring", () => {
  test("step 2 checks cache before researching", () => {
    const body = interviewResearchStep();
    expect(body).not.toBe("");
    expect(body).toContain("research/");
    expect(body).toMatch(/[Cc]heck the cache/);
  });

  test("step 2 writes back after fresh research", () => {
    expect(interviewResearchStep()).toMatch(/write.*cache|cache file with/);
  });

  test("step 2 still requires verification before using a claim", () => {
    expect(interviewResearchStep()).toContain("Verify before using");
  });

  test("step 2 cache paragraph restates verification still applies", () => {
    expect(interviewResearchStep()).toMatch(/still applies/);
  });
});
