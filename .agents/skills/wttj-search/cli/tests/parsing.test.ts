import { describe, test, expect } from "bun:test";
import {
  cleanHtml,
  contractFromLd,
  cutoffDate,
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
  timestamp,
  toResult,
  CONTRACT_ALIASES,
  REMOTE_ALIASES,
  type WkHit,
} from "../src/helpers";

function hit(overrides: Partial<WkHit> = {}): WkHit {
  return {
    slug: "senior-data-engineer_paris_GITGU_1O04qgL",
    name: "Senior Data Engineer",
    reference: "GITGU_1O04qgL",
    objectID: "2897001",
    published_at: "2026-07-24T14:00:00.000+02:00",
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
    organization: { name: "GitGuardian", slug: "gitguardian" },
    ...overrides,
  };
}

describe("toResult — the portal-skill contract shape", () => {
  test("id is <org-slug>/<job-slug>, which addresses the public job page", () => {
    expect(toResult(hit())!.id).toBe("gitguardian/senior-data-engineer_paris_GITGU_1O04qgL");
  });

  test("the URL is the robots-allowed /fr/companies/... path (no query string)", () => {
    const url = toResult(hit())!.url;
    expect(url).toBe(
      "https://www.welcometothejungle.com/fr/companies/gitguardian/jobs/senior-data-engineer_paris_GITGU_1O04qgL",
    );
    expect(url).not.toContain("?");
  });

  test("carries the required contract fields", () => {
    expect(toResult(hit())).toMatchObject({
      title: "Senior Data Engineer",
      company: "GitGuardian",
      location: "Paris, France",
      date: "2026-07-24T14:00:00.000+02:00",
      contract: "CDI",
      contract_type: "FULL_TIME",
      remote: "partial",
      salary: "60000–70000 EUR/yearly",
    });
  });

  test("a hit without an org slug is dropped rather than yielding a broken URL", () => {
    expect(toResult(hit({ organization: { name: "GitGuardian" } }))).toBeNull();
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
    expect(toResult(hit({ contract_type_names: null, contract_type: "INTERNSHIP" }))!.contract).toBe("Stage");
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
  });
});

describe("dedupe — WTTJ indexes one record per job per website (up to 16)", () => {
  test("keeps the first hit for a repeated reference", () => {
    const rows = [hit(), hit({ slug: "same-job-other-website" }), hit({ reference: "OTHER_1" })]
      .map(toResult)
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const out = dedupe(rows);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("gitguardian/senior-data-engineer_paris_GITGU_1O04qgL");
  });
});

describe("timestamp — offsets, not string order", () => {
  test("a +02:00 posting is correctly older than a later UTC one", () => {
    // Naive string comparison gets this backwards: "20:00…+02:00" > "19:00…Z".
    const local = "2026-07-10T20:00:00.000+02:00"; // 18:00Z
    const utc = "2026-07-10T19:00:00.000Z";
    expect(timestamp(local)).toBeLessThan(timestamp(utc));
    expect(local > utc).toBe(true); // the trap this function exists to avoid
  });

  test("an absent or unparseable date sorts oldest instead of throwing", () => {
    expect(timestamp(null)).toBe(Number.NEGATIVE_INFINITY);
    expect(timestamp("not a date")).toBe(Number.NEGATIVE_INFINITY);
  });

  test("cutoffDate is N days back in epoch-ms", () => {
    const delta = Date.now() - cutoffDate(7);
    expect(delta).toBeGreaterThan(6.9 * 86400000);
    expect(delta).toBeLessThan(7.1 * 86400000);
  });
});

describe("parseCredentials — the site's runtime-env payload", () => {
  const payload =
    'window.env = {"PUBLIC_ALGOLIA_API_KEY_CLIENT":"4bd8f6215d0cc52b26430765769e65a0",' +
    '"PUBLIC_ALGOLIA_APPLICATION_ID":"CSEKHVMS53","PUBLIC_OTEL_DEPLOYMENT_ENVIRONMENT":"production"}';

  test("reads the app id and client search key", () => {
    expect(parseCredentials(payload)).toEqual({
      appId: "CSEKHVMS53",
      apiKey: "4bd8f6215d0cc52b26430765769e65a0",
      index: "wk_cms_jobs_production",
    });
  });

  test("recovers the keys from a payload that is not parseable as one JSON object", () => {
    const broken = 'window.env = {"PUBLIC_ALGOLIA_API_KEY_CLIENT":"abc","PUBLIC_ALGOLIA_APPLICATION_ID":"XYZ",';
    expect(parseCredentials(broken)?.apiKey).toBe("abc");
    expect(parseCredentials(broken)?.appId).toBe("XYZ");
  });

  test("returns null when the key is gone (payload changed)", () => {
    expect(parseCredentials('window.env = {"PUBLIC_NODE_ENV":"production"}')).toBeNull();
  });
});

describe("escapeControlCharsInStrings — ld+json with raw newlines", () => {
  test("escapes newlines inside string literals but not between tokens", () => {
    const raw = '{\n  "a": "line1\nline2",\n  "b": 1\n}';
    expect(JSON.parse(escapeControlCharsInStrings(raw))).toEqual({ a: "line1\nline2", b: 1 });
  });

  test("a quote escaped inside a string does not flip string state", () => {
    const raw = '{"a": "say \\"hi\\"\nthere"}';
    expect(JSON.parse(escapeControlCharsInStrings(raw))).toEqual({ a: 'say "hi"\nthere' });
  });
});

describe("parseJobPosting", () => {
  test("finds the JobPosting block past the FAQPage block WTTJ also emits", () => {
    const html = `
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[]}</script>
      <script type="application/ld+json">{"@type":"JobPosting","title":"Data Engineer"}</script>
    `;
    expect(parseJobPosting(html)?.title).toBe("Data Engineer");
  });

  test("a malformed block does not hide a later valid one", () => {
    const html = `
      <script type="application/ld+json">{ not json </script>
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
    expect(contractFromLd("APPRENTICESHIP").label).toBe("Alternance");
    expect(contractFromLd(undefined).label).toBeNull();
  });

  test("jobLocation works as an array or a bare object", () => {
    const address = { addressLocality: "Paris", addressCountry: "France" };
    expect(locationFromLd({ jobLocation: [{ address }] })).toBe("Paris, France");
    expect(locationFromLd({ jobLocation: { address } })).toBe("Paris, France");
    expect(locationFromLd({})).toBeNull();
  });

  test("baseSalary handles the object, string, and null shapes", () => {
    expect(salaryFromLd({ currency: "EUR", value: { minValue: 45000, maxValue: 55000, unitText: "YEAR" } })).toBe(
      "45000–55000 EUR/year",
    );
    expect(salaryFromLd("60000")).toBe("60000");
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
});

describe("normalizeId", () => {
  test("accepts an org/slug pair and a full WTTJ job URL in any locale", () => {
    expect(normalizeId("gitguardian/senior-data-engineer_paris")).toEqual({
      org: "gitguardian",
      slug: "senior-data-engineer_paris",
    });
    expect(normalizeId("https://www.welcometothejungle.com/fr/companies/joko/jobs/backend_paris")).toEqual({
      org: "joko",
      slug: "backend_paris",
    });
    expect(normalizeId("https://www.welcometothejungle.com/en/companies/joko/jobs/backend_paris")).toEqual({
      org: "joko",
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
    expect(resolveAlias(CONTRACT_ALIASES, "cdd")).toBe("TEMPORARY");
    expect(resolveAlias(CONTRACT_ALIASES, "cdi permanent")).toBeNull();
  });

  test("télétravail modes resolve in French and English", () => {
    expect(resolveAlias(REMOTE_ALIASES, "hybride")).toBe("partial");
    expect(resolveAlias(REMOTE_ALIASES, "ponctuel")).toBe("punctual");
    expect(resolveAlias(REMOTE_ALIASES, "onsite")).toBe("no");
  });
});
