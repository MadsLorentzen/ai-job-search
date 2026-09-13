/** Guards for the /setup workflow spec. Port of tests/test_setup_command.py. */
import { describe, expect, test } from "bun:test";
import { SKILLS, WORKFLOWS, read, sections, FACTORY, PROFILE } from "./helpers.ts";

const COMMAND = `${WORKFLOWS}/setup.md`;
const CV_TEMPLATES = `${FACTORY}/05-cv-templates.md`;
const COVER_TEMPLATES = `${FACTORY}/06-cover-letter-templates.md`;

function substeps(stepBody: string): Record<string, string> {
  return sections(stepBody, "###");
}

const step3 = () => sections(read(COMMAND))["Step 3: Generate Profile Files"] ?? "";
const setupSubsteps = () => substeps(step3());

function substepFor(filename: string): string {
  const matches = Object.entries(setupSubsteps()).filter(([h]) => h.includes(filename));
  expect(matches.length).toBe(1);
  return matches[0]![1];
}

describe("/setup step3 contact blocks", () => {
  test("cv templates substep fills the contact block", () => {
    const body = substepFor("05-cv-templates.md");
    expect(body.toLowerCase()).toContain("contact");
    for (const token of ["[FIRST_NAME]", "[YOUR_EMAIL]", "[YOUR_PHONE]"]) {
      expect(body).toContain(token);
    }
  });

  test("cover letter templates get their own substep", () => {
    const body = substepFor("06-cover-letter-templates.md");
    expect(body.toLowerCase()).toContain("signature");
    for (const token of ["[YOUR_NAME]", "[YOUR_EMAIL]", "[YOUR_PHONE]", "[YOUR_LINKEDIN_URL]"]) {
      expect(body).toContain(token);
    }
  });

  test("completion summary lists the cover letter templates", () => {
    const step4 = sections(read(COMMAND))["Step 4: Confirm & Next Steps"] ?? "";
    const summary = step4.split("**Privacy note:**")[0]!;
    expect(summary).toContain("06-cover-letter-templates.md");
  });
});

describe("templates still carry the placeholders", () => {
  test("cv templates contact block tokens", () => {
    const text = read(CV_TEMPLATES);
    for (const token of ["[FIRST_NAME]", "[LAST_NAME]", "[YOUR_EMAIL]", "[YOUR_PHONE]"]) {
      expect(text).toContain(token);
    }
  });

  test("cover letter templates contact and signature tokens", () => {
    const text = read(COVER_TEMPLATES);
    for (const token of ["[YOUR_NAME]", "[YOUR_EMAIL]", "[YOUR_PHONE]", "[YOUR_LINKEDIN_URL]"]) {
      expect(text).toContain(token);
    }
    expect(text).toContain("\\signature{[YOUR_NAME]}");
  });
});
