import { describe, test, expect } from "bun:test";
import { cleanHtml, normalizeSlug, toResult, toDetail, type FreehireJob } from "../src/helpers";

function job(overrides: Partial<FreehireJob> = {}): FreehireJob {
  return {
    public_slug: "backend-engineer-acme-ab12cd34",
    source: "greenhouse",
    external_id: "acme:1",
    url: "https://boards.greenhouse.io/acme/jobs/1",
    title: "Backend Engineer",
    company: "Acme",
    company_slug: "acme",
    location: "Berlin, Germany",
    description: "<ul><li>Build APIs</li><li>Ship &amp; iterate</li></ul>",
    skills: ["go", "kubernetes"],
    work_mode: "remote",
    regions: ["eu"],
    countries: ["de"],
    cities: ["Berlin"],
    posted_at: "2026-07-06T00:00:00Z",
    created_at: "2026-07-06T15:00:00Z",
    enrichment: {},
    ...overrides,
  };
}

describe("toResult — reshape into the portal-skill contract", () => {
  test("maps public_slug -> id and posted_at -> date", () => {
    const r = toResult(job());
    expect(r.id).toBe("backend-engineer-acme-ab12cd34");
    expect(r.date).toBe("2026-07-06T00:00:00Z");
  });

  test("carries the required contract fields", () => {
    const r = toResult(job());
    expect(r).toMatchObject({
      title: "Backend Engineer",
      company: "Acme",
      company_slug: "acme",
      location: "Berlin, Germany",
      url: "https://boards.greenhouse.io/acme/jobs/1",
    });
  });

  test("missing values are null, not omitted", () => {
    const r = toResult(job({ company: "", location: "", posted_at: null, work_mode: undefined }));
    expect(r.company).toBeNull();
    expect(r.location).toBeNull();
    expect(r.date).toBeNull();
    expect(r.work_mode).toBeNull();
  });

  test("decodes HTML entities and trims whitespace in the title", () => {
    // Real title from the index (freehire slug intern-fullstack-amp-ai-innovation-noise-edaawqq2).
    expect(toResult(job({ title: "Intern - Fullstack &amp; AI Innovation " })).title).toBe(
      "Intern - Fullstack & AI Innovation",
    );
    expect(toResult(job({ title: "R&#38;D Engineer" })).title).toBe("R&D Engineer");
    expect(toResult(job({ title: "SDE Intern - Frontend   " })).title).toBe("SDE Intern - Frontend");
  });

  test("a whitespace-only title still falls back to (untitled)", () => {
    expect(toResult(job({ title: "   " })).title).toBe("(untitled)");
    expect(toResult(job({ title: "" })).title).toBe("(untitled)");
  });

  test("detail inherits the cleaned title", () => {
    expect(toDetail(job({ title: "Data &amp; Analytics Intern" })).title).toBe("Data & Analytics Intern");
  });
});

describe("toDetail — adds cleaned description + enrichment", () => {
  test("strips HTML and decodes entities in the description", () => {
    const d = toDetail(job());
    expect(d.description).toBe("Build APIs\nShip & iterate");
  });

  test("surfaces enrichment fields and a formatted salary", () => {
    const d = toDetail(
      job({
        enrichment: { seniority: "senior", category: "backend", employment_type: "full_time", salary_min: 90000, salary_max: 120000, salary_currency: "EUR" },
      }),
    );
    expect(d.seniority).toBe("senior");
    expect(d.category).toBe("backend");
    expect(d.salary).toBe("EUR 90000–120000");
  });

  test("keeps the salary period, so a yearly figure is not read as monthly", () => {
    const d = toDetail(
      job({ enrichment: { salary_min: 300000, salary_max: 300000, salary_currency: "INR", salary_period: "year" } }),
    );
    expect(d.salary).toBe("INR 300000–300000/year");
  });

  test("a single-bound salary keeps its period too", () => {
    const d = toDetail(job({ enrichment: { salary_min: 12000, salary_currency: "INR", salary_period: "month" } }));
    expect(d.salary).toBe("INR 12000/month");
  });

  test("null enrichment fields when the enrichment object is empty", () => {
    const d = toDetail(job({ enrichment: {} }));
    expect(d.seniority).toBeNull();
    expect(d.salary).toBeNull();
  });
});

describe("cleanHtml", () => {
  test("preserves paragraph breaks between blocks", () => {
    expect(cleanHtml("<p>One</p><p>Two</p>")).toBe("One\nTwo");
  });
  test("decodes hex numeric entities", () => {
    expect(cleanHtml("Caf&#xE9;")).toBe("Café");
  });
  test("returns null for empty input", () => {
    expect(cleanHtml("")).toBeNull();
    expect(cleanHtml(null)).toBeNull();
  });
});

describe("normalizeSlug", () => {
  test("accepts a bare slug", () => {
    expect(normalizeSlug("golang-zensar-2bxu6dxm")).toBe("golang-zensar-2bxu6dxm");
  });
  test("extracts the slug from a /jobs/<slug> URL", () => {
    expect(normalizeSlug("https://freehire.me/jobs/golang-zensar-2bxu6dxm")).toBe("golang-zensar-2bxu6dxm");
  });
  test("rejects a non-slug string", () => {
    expect(normalizeSlug("not a slug!")).toBeNull();
    expect(normalizeSlug("")).toBeNull();
  });
});
