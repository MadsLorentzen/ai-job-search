/** Guards for the onboarding privacy warnings. Port of
 * tests/test_onboarding_privacy.py (setup workflow now at
 * methods/setup.md). */
import { describe, expect, test } from "bun:test";
import { REPO, WORKFLOWS, read, headingSection } from "./helpers.ts";

const README = `${REPO}/README.md`;
const SETUP_GUIDE = `${REPO}/SETUP.md`;
const SETUP_COMMAND = `${WORKFLOWS}/setup.md`;

function assertWarns(body: string): void {
  expect(body.toLowerCase()).toContain("public");
  expect(body).toContain("personal data");
  expect(body.match(/section 8|§8|#8-pulling/i)).not.toBeNull();
}

describe("fork warnings at the decision point", () => {
  test("README quick start warns next to the fork command", () => {
    const body = headingSection(read(README), "### 1. Fork and clone");
    expect(body).toContain("gh repo fork");
    assertWarns(body);
  });

  test("SETUP.md warns next to the fork command", () => {
    const body = headingSection(read(SETUP_GUIDE), "## 2. Fork and clone");
    expect(body).toContain("gh repo fork");
    assertWarns(body);
  });
});

describe("/setup checks origin before writing", () => {
  test("preflight exists and precedes profile generation", () => {
    const text = read(SETUP_COMMAND);
    expect(text).toContain("git remote get-url origin");
    const preflightAt = text.indexOf("git remote get-url origin");
    const writesAt = text.indexOf("## Step 3: Generate Profile Files");
    expect(preflightAt).toBeLessThan(writesAt);
    expect(
      text.slice(Math.max(0, preflightAt - 2000), preflightAt + 2000).toLowerCase(),
    ).toContain("public");
  });
});
