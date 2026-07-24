import { describe, test, expect } from "bun:test";
import { join } from "path";
import { parseJobPosting } from "../src/helpers";
import { toDetail, toDetailFromRecord } from "../src/commands/detail";
import type { WkHit } from "../src/helpers";

// The live `detail` path depends on the site being reachable, and the site's WAF
// throttles hard. This exercises the same parsing against a captured real
// response, so a regression in the page path is caught offline — the live test in
// commands.test.ts covers reachability.

const fixture = await Bun.file(join(import.meta.dir, "fixtures/job-page.html")).text();

describe("detail from a real job page (fixture)", () => {
  const ld = parseJobPosting(fixture);

  test("finds the JobPosting among the page's ld+json blocks", () => {
    expect(ld).not.toBeNull();
    expect(ld!["@type"]).toBe("JobPosting");
  });

  test("maps the page onto the contract shape", () => {
    const job = toDetail(ld!, "gitguardian", "senior-data-engineer_paris_GITGU_1O04qgL");
    expect(job).toMatchObject({
      id: "gitguardian/senior-data-engineer_paris_GITGU_1O04qgL",
      title: "Senior Data Engineer",
      company: "GitGuardian",
      location: "Paris, France",
      contract: "CDI",
      contract_type: "FULL_TIME",
      source: "page",
    });
    expect(job.url).toBe(
      "https://www.welcometothejungle.com/fr/companies/gitguardian/jobs/senior-data-engineer_paris_GITGU_1O04qgL",
    );
    expect(job.date).toStartWith("2026-07-24");
    expect(job.valid_through).toStartWith("2026-10-22");
  });

  test("the description is readable prose, not markup", () => {
    const job = toDetail(ld!, "gitguardian", "senior-data-engineer_paris_GITGU_1O04qgL");
    expect(job.description!.length).toBeGreaterThan(1000);
    expect(job.description).not.toMatch(/<\/?(p|div|li|ul|br)\b/i);
    expect(job.description).not.toMatch(/&(amp|nbsp|lt|gt|#\d+);/);
    expect(job.description).toContain("GitGuardian");
  });

  test("fields the page does not publish stay null rather than being guessed", () => {
    const job = toDetail(ld!, "gitguardian", "senior-data-engineer_paris_GITGU_1O04qgL");
    expect(job.remote).toBeNull();
    expect(job.department).toBeNull();
  });
});

describe("detail from the search index (WAF fallback)", () => {
  const hit: WkHit = {
    slug: "senior-data-engineer_paris_GITGU_1O04qgL",
    name: "Senior Data Engineer",
    reference: "GITGU_1O04qgL",
    published_at: "2026-07-24T14:00:00.000+02:00",
    contract_type: "FULL_TIME",
    contract_type_names: { fr: "CDI" },
    remote: "partial",
    department: "Tech",
    experience_level_minimum: 5,
    education_level: "BAC_5",
    profile: "<p>Vous ma&#238;trisez Python et Airflow.</p>",
    office: { city: "Paris", country: "France" },
    organization: { name: "GitGuardian", slug: "gitguardian" },
  };

  test("carries the structured fields the page path lacks, and says where it came from", () => {
    const job = toDetailFromRecord(hit, "gitguardian", "senior-data-engineer_paris_GITGU_1O04qgL")!;
    expect(job.source).toBe("index");
    expect(job.remote).toBe("partial");
    expect(job.department).toBe("Tech");
    expect(job.education).toBe("BAC_5");
    expect(job.experience).toBe("> 5 ans");
  });

  test("description is honestly null and the requirements text is decoded", () => {
    const job = toDetailFromRecord(hit, "gitguardian", "senior-data-engineer_paris_GITGU_1O04qgL")!;
    expect(job.description).toBeNull();
    expect(job.qualifications).toBe("Vous maîtrisez Python et Airflow.");
  });

  test("a record without an org slug yields null rather than a broken result", () => {
    expect(toDetailFromRecord({ ...hit, organization: null }, "x", "y")).toBeNull();
  });
});
