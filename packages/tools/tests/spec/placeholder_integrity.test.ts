/** Guards for CI's placeholder-integrity sentinels. Port of
 * tests/test_placeholder_integrity.py with the post-migration paths
 * (profile/profile.md, .pi-agent/skills). Upstream-only, like the CI job. */
import { describe, expect, test } from "bun:test";
import { REPO, SKILLS, read } from "./helpers.ts";

const UPSTREAM = "MadsLorentzen/ai-job-search";

const CI = `${REPO}/.github/workflows/ci.yml`;
const EXAMPLE_CV = `${REPO}/cv/main_example.tex`;
const PROFILE = `${SKILLS}/job-application-assistant/01-candidate-profile.md`;
const CANDIDATE_PROFILE = `${REPO}/profile/profile.md`;

const CV_SENTINELS = ["\\name{[First]}{[Last]}", "\\email{[your.email@example.com]}"];
const PROFILE_SENTINEL = "[YOUR_EMAIL]";

const isUpstream = (process.env.GITHUB_REPOSITORY ?? UPSTREAM) === UPSTREAM;

function personalizeCv(text: string): string {
  return text
    .split("\\name{[First]}{[Last]}").join("\\name{Jane}{Doe}")
    .split("[Your Address, City, Country]").join("Some Street 1, Aarhus, Denmark")
    .split("[+XX XXXXXXXXXX]").join("+45 12345678")
    .split("[your.email@example.com]").join("jane.doe@example.org");
}

describe.skipIf(!isUpstream)("cv sentinels are data-located", () => {
  test("ci checks the name and email data lines", () => {
    const ci = read(CI);
    expect(ci).toContain("check cv/main_example.tex '\\\\name{\\[First\\]}{\\[Last\\]}'");
    expect(ci).toContain("check cv/main_example.tex '\\\\email{\\[your\\.email@example\\.com\\]}'");
  });
  test("pristine cv carries both sentinels", () => {
    const cv = read(EXAMPLE_CV);
    for (const sentinel of CV_SENTINELS) {
      expect(cv).toContain(sentinel);
    }
  });

  test("the /setup edit destroys the sentinels", () => {
    const cv = read(EXAMPLE_CV);
    const personalized = personalizeCv(cv);
    expect(personalized).not.toBe(cv);
    const surviving = CV_SENTINELS.filter((s) => personalized.includes(s));
    expect(surviving).toEqual([]);
  });
});

describe.skipIf(!isUpstream)("skill profile sentinel is data-located", () => {
  test("ci checks a data placeholder, not a header comment", () => {
    const ci = read(CI);
    expect(ci).toContain(
      "check .pi-agent/skills/job-application-assistant/01-candidate-profile.md '\\[YOUR_EMAIL\\]'",
    );
  });

  test("pristine profile carries the sentinel", () => {
    expect(read(PROFILE)).toContain(PROFILE_SENTINEL);
  });
});

describe.skipIf(!isUpstream)("candidate profile sentinel", () => {
  test("ci checks profile/profile.md (the old CLAUDE.md sentinel)", () => {
    const ci = read(CI);
    expect(ci).toContain("check profile/profile.md '\\[YOUR_NAME\\]'");
  });

  test("pristine profile carries the sentinel", () => {
    expect(read(CANDIDATE_PROFILE)).toContain("[YOUR_NAME]");
  });
});
