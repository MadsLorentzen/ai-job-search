import { describe, test, expect } from "bun:test";
import {
  cleanHtml,
  contractFromLd,
  dedupe,
  escapeControlCharsInStrings,
  formatLocation,
  formatSalary,
  locationFromLd,
  normalizeId,
  parseCredentials,
  parseJobPosting,
  resolveAlias,
  salaryFromLd,
  toResult,
  CONTRACT_ALIASES,
  REMOTE_ALIASES,
  type WkHit,
} from "../src/helpers";

function hit(overrides: Partial<WkHit> = {}): WkHit {
  return {
    slug: "data-engineer-h-f_paris",
    name: "Senior Data Engineer (H/F)",
    reference: "ALLPH_j9ALd5z",
    objectID: "2897367",
    published_at: "2026-07-24T12:00:00.000+02:00",
    contract_type: "FULL_TIME",
    contract_type_names: { fr: "CDI", en: "Full-Time" },
    remote: "partial",
    department: "Tech",
    experience_level_minimum: 5,
    salary_currency: "EUR",
    salary_minimum: 60000,
    salary_maximum: 70000,
    salary_period: "yearly",
    office: { city: "Paris", district: "Paris", state: "Ile-de-France", country: "France", country_code: "FR" },
    organization: { name: "Allphins", slug: "allphins" },
    ...overrides,
  };
}

describe("toResult — the portal-skill contract shape", () => {
  test("id is <org-slug>/<job-slug>, which addresses the public job page", () => {
    expect(toResult(hit())!.id).toBe("allphins/data-engineer-h-f_paris");
  });

  test("carries the required contract fields", () => {
    expect(toResult(hit())).toMatchObject({
      title: "Senior Data Engineer (H/F)",
      company: "Allphins",
      location: "Paris, France",
      date: "2026-07-24T12:00:00.000+02:00",
      url: "https://jobs.stationf.co/companies/allphins/jobs/data-engineer-h-f_paris",
      contract: "CDI",
      contract_type: "FULL_TIME",
      remote: "partial",
      salary: "60000–70000 EUR/yearly",
    });
  });

  test("a hit without an org slug is dropped rather than yielding a broken URL", () => {
    expect(toResult(hit({ organization: { name: "Allphins" } }))).toBeNull();
    expect(toResult(hit({ slug: undefined }))).toBeNull();
  });

  test("missing values are null, never omitted", () => {
    const r = toResult(hit({ department: null, remote: null, published_at: null }))!;
    expect(r.department).toBeNull();
    expect(r.remote).toBeNull();
    expect(r.date).toBeNull();
    expect("department" in r).toBe(true);
  });

  test("falls back to the contract code mapping when the record has no fr name", () => {
    const r = toResult(hit({ contract_type_names: null, contract_type: "APPRENTICESHIP" }))!;
    expect(r.contract).toBe("Alternance");
  });
});

describe("formatLocation / formatSalary", () => {
  test("uses the offices[] array when the flat office field is absent", () => {
    expect(formatLocation(hit({ office: null, offices: [{ city: "Lyon", country: "France" }] }))).toBe(
      "Lyon, France",
    );
  });

  test("falls back through district and region when there is no city", () => {
    expect(formatLocation(hit({ office: { state: "Ile-de-France" }, offices: null }))).toBe("Ile-de-France");
  });

  test("no salary fields means null, not a bogus range", () => {
    expect(formatSalary(hit({ salary_minimum: null, salary_maximum: null }))).toBeNull();
  });

  test("a single-value salary is not rendered as a range", () => {
    expect(formatSalary(hit({ salary_maximum: null }))).toBe("60000 EUR/yearly");
    expect(formatSalary(hit({ salary_minimum: 60000, salary_maximum: 60000 }))).toBe("60000 EUR/yearly");
  });
});

describe("dedupe — Welcomekit indexes one record per job per website", () => {
  test("keeps the first hit for a repeated reference", () => {
    const rows = [hit(), hit({ slug: "data-engineer-h-f_paris-2" }), hit({ reference: "OTHER_1" })]
      .map(toResult)
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const out = dedupe(rows);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("allphins/data-engineer-h-f_paris");
  });
});

describe("parseCredentials", () => {
  const page = `
    <script>
      window.legacyEnv = { algoliaAppId: "CSEKHVMS53", algoliaIndexSuffix: "production_careers" }
    </script>
    <input type="hidden" name="algolia_api_key" id="algolia_api_key" value="ZTQzYjA0" autocomplete="off" />
  `;

  test("reads the app id, index suffix, and search key off the board page", () => {
    expect(parseCredentials(page)).toEqual({
      appId: "CSEKHVMS53",
      apiKey: "ZTQzYjA0",
      index: "wk_cms_jobs_production_careers",
    });
  });

  test("returns null when the key element is gone (markup changed)", () => {
    expect(parseCredentials("<html><body>no key here</body></html>")).toBeNull();
  });
});

describe("escapeControlCharsInStrings — the board emits invalid ld+json", () => {
  test("escapes newlines inside string literals but not between tokens", () => {
    const raw = '{\n  "a": "line1\nline2",\n  "b": 1\n}';
    expect(JSON.parse(escapeControlCharsInStrings(raw))).toEqual({ a: "line1\nline2", b: 1 });
  });

  test("leaves an already-escaped sequence alone", () => {
    const raw = '{"a": "line1\\nline2"}';
    expect(JSON.parse(escapeControlCharsInStrings(raw))).toEqual({ a: "line1\nline2" });
  });

  test("a quote escaped inside a string does not flip string state", () => {
    const raw = '{"a": "say \\"hi\\"\nthere"}';
    expect(JSON.parse(escapeControlCharsInStrings(raw))).toEqual({ a: 'say "hi"\nthere' });
  });
});

describe("parseJobPosting", () => {
  test("finds the JobPosting block past a non-JobPosting one", () => {
    const html = `
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[]}</script>
      <script type="application/ld+json">{"@type":"JobPosting","title":"Data Engineer"}</script>
    `;
    expect(parseJobPosting(html)?.title).toBe("Data Engineer");
  });

  test("recovers a block with raw newlines in its description", () => {
    const html = `<script type="application/ld+json">{"@type":"JobPosting","title":"X","description":"a\nb"}</script>`;
    expect(parseJobPosting(html)?.description).toBe("a\nb");
  });

  test("a malformed block does not hide a later valid one", () => {
    const html = `
      <script type="application/ld+json">{ this is not json </script>
      <script type="application/ld+json">{"@type":"JobPosting","title":"Y"}</script>
    `;
    expect(parseJobPosting(html)?.title).toBe("Y");
  });

  test("returns null when there is no JobPosting", () => {
    expect(parseJobPosting("<html></html>")).toBeNull();
  });
});

describe("ld+json field mapping", () => {
  test("employmentType maps to the French label in both spellings", () => {
    expect(contractFromLd("FULL_TIME").label).toBe("CDI");
    expect(contractFromLd("Full-Time").label).toBe("CDI");
    expect(contractFromLd("Internship").label).toBe("Stage");
    expect(contractFromLd(undefined).label).toBeNull();
  });

  test("jobLocation works as an array or a bare object", () => {
    const address = { addressLocality: "Paris", addressCountry: "France" };
    expect(locationFromLd({ jobLocation: [{ address }] })).toBe("Paris, France");
    expect(locationFromLd({ jobLocation: { address } })).toBe("Paris, France");
    expect(locationFromLd({})).toBeNull();
  });

  test("baseSalary handles the string, range, and absent shapes", () => {
    expect(salaryFromLd("60000")).toBe("60000");
    expect(salaryFromLd({ currency: "EUR", value: { minValue: 45000, maxValue: 55000, unitText: "YEAR" } })).toBe(
      "45000–55000 EUR/year",
    );
    expect(salaryFromLd(null)).toBeNull();
  });
});

describe("cleanHtml", () => {
  test("keeps list items on their own lines and decodes entities", () => {
    expect(cleanHtml("<ul><li>Pipelines &amp; ETL</li><li>Dbt</li></ul>")).toBe("Pipelines & ETL\nDbt");
  });

  test("decodes French accents from numeric references", () => {
    expect(cleanHtml("<p>D&#233;veloppeur exp&#xE9;riment&#233;</p>")).toBe("Développeur expérimenté");
  });

  test("does not double-decode an escaped entity", () => {
    expect(cleanHtml("<p>&amp;lt;script&amp;gt;</p>")).toBe("&lt;script&gt;");
  });

  test("empty input is null", () => {
    expect(cleanHtml("")).toBeNull();
    expect(cleanHtml(null)).toBeNull();
  });
});

describe("normalizeId", () => {
  test("accepts an org/slug pair and a full board URL", () => {
    expect(normalizeId("allphins/data-engineer-h-f_paris")).toEqual({
      org: "allphins",
      slug: "data-engineer-h-f_paris",
    });
    expect(normalizeId("https://jobs.stationf.co/companies/joko-1/jobs/backend_paris")).toEqual({
      org: "joko-1",
      slug: "backend_paris",
    });
  });

  test("rejects free text and unrelated URLs", () => {
    expect(normalizeId("not an id!")).toBeNull();
    expect(normalizeId("https://example.com/jobs/1")).toBeNull();
    expect(normalizeId("")).toBeNull();
  });
});

describe("flag alias tables", () => {
  test("French contract words resolve to the index codes", () => {
    expect(resolveAlias(CONTRACT_ALIASES, "CDI")).toBe("FULL_TIME");
    expect(resolveAlias(CONTRACT_ALIASES, "alternance")).toBe("APPRENTICESHIP");
    expect(resolveAlias(CONTRACT_ALIASES, "Stage")).toBe("INTERNSHIP");
    expect(resolveAlias(CONTRACT_ALIASES, "cdi permanent")).toBeNull();
  });

  test("télétravail modes resolve in French and English", () => {
    expect(resolveAlias(REMOTE_ALIASES, "hybride")).toBe("partial");
    expect(resolveAlias(REMOTE_ALIASES, "full")).toBe("fulltime");
    expect(resolveAlias(REMOTE_ALIASES, "onsite")).toBe("no");
  });
});
