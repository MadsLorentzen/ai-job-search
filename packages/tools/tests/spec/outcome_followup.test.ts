/** Guards for /outcome's follow-up branch (Step 2b). Port of
 * tests/test_outcome_followup.py. */
import { describe, expect, test } from "bun:test";
import { WORKFLOWS, read } from "./helpers.ts";

const COMMAND = `${WORKFLOWS}/outcome.md`;

describe("/outcome follow-up branch spec", () => {
  const text = () => read(COMMAND);

  test("follow-up branch exists", () => {
    expect(text()).toContain("## Step 2b: Follow-Up Branch");
  });

  test("followup argument documented", () => {
    expect(text()).toContain("`followup <N>`");
  });

  test("draft-only rule present", () => {
    expect(text()).toContain("draft only, never send");
  });

  test("no-new-claims rule present", () => {
    expect(text()).toContain("no new claims");
  });

  test("two-followup cap present", () => {
    expect(text()).toContain("Maximum two follow-ups per application");
  });

  test("threshold contrast with gmail-sync documented", () => {
    expect(text()).toContain("30-day staleness flag");
  });
});
