/** Guards for /outcome's stale sweep branch (Step 2c). Port of
 * tests/test_outcome_stale.py. */
import { describe, expect, test } from "bun:test";
import { WORKFLOWS, read } from "./helpers.ts";

const COMMAND = `${WORKFLOWS}/outcome.md`;

function step2c(): string {
  const m = /## Step 2c: Stale Sweep Branch([\s\S]*?)(?=## Step 3:)/.exec(read(COMMAND));
  return m?.[1] ?? "";
}

describe("/outcome stale sweep branch spec", () => {
  const text = () => read(COMMAND);

  test("stale argument documented in step0", () => {
    expect(text()).toContain("`stale` or `sweep`");
    expect(text()).toContain("`stale <N>` or `sweep <N>`");
  });

  test("step1 suggests stale sweep", () => {
    expect(text()).toContain("/outcome stale");
    expect(text()).toContain("60+ days");
  });

  test("step2c section exists", () => {
    expect(text()).toContain("## Step 2c: Stale Sweep Branch");
  });

  test("drafted rows excluded from stale candidates", () => {
    expect(step2c()).toContain("neither final nor `drafted`");
    expect(step2c()).toContain("never submitted and cannot receive a response");
  });

  test("default 60-day threshold", () => {
    expect(step2c()).toContain("60 days");
  });

  test("user confirmation options required", () => {
    for (const opt of ["`all`", "`select`", "`skip`"]) {
      expect(step2c()).toContain(opt);
    }
  });

  test("resolves to canonical no_response", () => {
    expect(step2c()).toContain("no_response");
  });
});
