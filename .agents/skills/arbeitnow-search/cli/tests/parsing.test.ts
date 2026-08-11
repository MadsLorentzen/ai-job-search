import { describe, test, expect } from "bun:test";
import { filterJobs, parseJobDetail, extractMeta } from "../src/helpers";

function apiPage(jobs: any[], page = 1, perPage = 176) {
  return {
    data: jobs,
    links: { first: "x", last: null, prev: null, next: "x" },
    meta: { current_page: page, current_page_url: "x", from: 1, path: "x", per_page: perPage, to: jobs.length, terms: "", info: "" },
  };
}

const now = Math.floor(Date.now() / 1000);

function job(overrides: Partial<Record<string, any>> = {}) {
  return {
    slug: "some-job-slug-12345",
    company_name: "Acme GmbH",
    title: "Product Owner",
    description: "<p>desc</p>",
    remote: false,
    url: "https://www.arbeitnow.com/jobs/companies/acme/some-job-slug-12345",
    tags: ["Product"],
    job_types: ["Full-time"],
    location: "Berlin, Berlin",
    created_at: now - 86400, // 1 day ago
    ...overrides,
  };
}

describe("filterJobs", () => {
  test("maps API fields to the JobCard shape with an ISO date", () => {
    const page = apiPage([job()]);
    const [c] = filterJobs(page, {});
    expect(c!.id).toBe("some-job-slug-12345");
    expect(c!.title).toBe("Product Owner");
    expect(c!.company).toBe("Acme GmbH");
    expect(c!.location).toBe("Berlin, Berlin");
    expect(c!.url).toBe("https://www.arbeitnow.com/jobs/companies/acme/some-job-slug-12345");
    expect(() => new Date(c!.date!).toISOString()).not.toThrow();
  });

  test("query matches title case-insensitively", () => {
    const page = apiPage([job({ title: "Senior Product Owner" }), job({ title: "Backend Engineer" })]);
    const results = filterJobs(page, { query: "product owner" });
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe("Senior Product Owner");
  });

  test("query matches company name", () => {
    const page = apiPage([job({ company_name: "Deutsche Bank" }), job({ company_name: "Other GmbH" })]);
    const results = filterJobs(page, { query: "deutsche" });
    expect(results.length).toBe(1);
  });

  test("query matches tags", () => {
    const page = apiPage([job({ tags: ["Product", "Fintech"] }), job({ tags: ["Sales"] })]);
    const results = filterJobs(page, { query: "fintech" });
    expect(results.length).toBe(1);
  });

  test("location filters as a case-insensitive substring", () => {
    const page = apiPage([job({ location: "Berlin, Berlin" }), job({ location: "Munich, Bavaria" })]);
    const results = filterJobs(page, { location: "berlin" });
    expect(results.length).toBe(1);
    expect(results[0]!.location).toBe("Berlin, Berlin");
  });

  test("jobageDays excludes postings older than N days", () => {
    const recent = job({ created_at: now - 2 * 86400 });
    const old = job({ created_at: now - 30 * 86400 });
    const page = apiPage([recent, old]);
    const results = filterJobs(page, { jobageDays: 7 });
    expect(results.length).toBe(1);
  });

  test("limit caps results after filtering", () => {
    const page = apiPage([job(), job(), job()]);
    const results = filterJobs(page, { limit: 2 });
    expect(results.length).toBe(2);
  });

  test("decodes numeric HTML entities in title and company", () => {
    const page = apiPage([job({ title: "Produktmanager &amp; Team", company_name: "M&#252;ller GmbH" })]);
    const [c] = filterJobs(page, {});
    expect(c!.title).toBe("Produktmanager & Team");
    expect(c!.company).toBe("Müller GmbH");
  });

  test("decodes named German umlaut entities — regression (Arbeitnow descriptions use &uuml; etc, not just numeric entities)", () => {
    const page = apiPage([job({ title: "Gesch&auml;ftsf&uuml;hrer (m/w/d)", company_name: "Gr&ouml;&szlig;e GmbH" })]);
    const [c] = filterJobs(page, {});
    expect(c!.title).toBe("Geschäftsführer (m/w/d)");
    expect(c!.company).toBe("Größe GmbH");
  });

  test("no filters returns everything on the page", () => {
    const page = apiPage([job(), job(), job()]);
    expect(filterJobs(page, {}).length).toBe(3);
  });
});

describe("extractMeta", () => {
  test("reads current_page and per_page from the API response", () => {
    const page = apiPage([job(), job()], 3, 176);
    const meta = extractMeta(page as any);
    expect(meta).toEqual({ count: 2, page: 3, perPage: 176 });
  });
});

describe("parseJobDetail", () => {
  function ldJsonHtml(jobPosting: Record<string, any>): string {
    return `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org/",
      "@graph": [{ "@type": "JobPosting", ...jobPosting }],
    })}</script></head><body></body></html>`;
  }

  test("extracts title, company, location, dates, employment type, benefits", () => {
    const html = ldJsonHtml({
      title: "Product Manager - Product Factory",
      description: "<p>Para one.</p><ul><li>Bullet one</li></ul>",
      datePosted: "2026-08-08T12:00:00.000000Z",
      validThrough: "2026-11-06T12:00:00.000000Z",
      employmentType: "FULL_TIME",
      hiringOrganization: { name: "N26" },
      jobLocation: { address: { addressLocality: "Berlin", addressRegion: "BERLIN", addressCountry: "DE" } },
      jobBenefits: "English speaker friendly",
    });
    const url = "https://www.arbeitnow.com/jobs/companies/n26/product-manager-product-factory-berlin-14255090";
    const d = parseJobDetail(html, url)!;
    expect(d.title).toBe("Product Manager - Product Factory");
    expect(d.company).toBe("N26");
    expect(d.location).toBe("Berlin, BERLIN, DE");
    expect(d.datePosted).toBe("2026-08-08T12:00:00.000000Z");
    expect(d.validThrough).toBe("2026-11-06T12:00:00.000000Z");
    expect(d.employmentType).toBe("FULL_TIME");
    expect(d.benefits).toBe("English speaker friendly");
    expect(d.description).toContain("Para one.");
    expect(d.description).toContain("Bullet one");
    expect(d.description).not.toContain("<");
    expect(d.url).toBe(url);
  });

  test("returns null when no JobPosting JSON-LD block is present", () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Organization"}</script></head></html>`;
    expect(parseJobDetail(html, "https://www.arbeitnow.com/x")).toBeNull();
  });

  test("missing optional fields are null, not thrown on", () => {
    const html = ldJsonHtml({ title: "Bare Job" });
    const d = parseJobDetail(html, "https://www.arbeitnow.com/x")!;
    expect(d.company).toBeNull();
    expect(d.location).toBeNull();
    expect(d.description).toBeNull();
    expect(d.benefits).toBeNull();
  });
});
