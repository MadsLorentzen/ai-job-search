import { afterEach, describe, expect, test } from "bun:test";
import { runSearch, withinDays, matchesLocation, type SearchOpts } from "../src/commands/search";
import { runDetail } from "../src/commands/detail";
import { cleanHtml, formatSalary, normalizeId, toResult, type EntraJob } from "../src/helpers";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

function captureStdout(): { get: () => string } {
  let buf = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  return { get: () => buf };
}

function captureStderr(): { get: () => string } {
  let buf = "";
  process.stderr.write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  return { get: () => buf };
}

/** Stub fetch; each call's URL is recorded. Responses are matched by path prefix. */
function mockFetch(routes: Array<{ path: string; status: number; body: unknown }>): { urls: () => string[] } {
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    const pathname = new URL(url).pathname;
    const route = routes.find((r) => pathname.endsWith(r.path) || pathname.includes(r.path));
    if (!route) return new Response(JSON.stringify({ statusCode: 404, error: "Not Found" }), { status: 404 });
    return new Response(typeof route.body === "string" ? route.body : JSON.stringify(route.body), {
      status: route.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { urls: () => requested };
}

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

function job(overrides: Partial<EntraJob> = {}): EntraJob {
  return {
    id: "25b71e5a-db28-43a2-84c0-1c7df875a547",
    title: "Product Manager, Mobile",
    description: "Who we are\n\nAbout Stripe\n\nStripe is a financial infrastructure platform.",
    requirements: null,
    employmentType: "full_time",
    workLocation: "remote",
    experienceLevel: "3_6_years",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: "USD",
    salaryPeriod: "monthly",
    source: "greenhouse",
    externalApplyUrl: "https://stripe.com/jobs/search?gh_jid=8140438",
    isActive: true,
    publishedAt: "2026-09-16T10:52:18.948Z",
    expiresAt: "2026-10-16T10:52:14.827Z",
    company: { id: "0dc3ab0b-985d-498b-a9fc-94b96a962f5b", name: "Stripe", slug: "stripe", isVerified: false },
    specialization: { nameEn: "Product Manager", slug: "product-manager" },
    country: { nameEn: "United States", slug: "usa" },
    city: { nameEn: "New York City", slug: "new-york-city" },
    ...overrides,
  };
}

function list(data: EntraJob[], total = data.length) {
  return { data, page: 1, limit: 25, total, totalPages: Math.max(1, Math.ceil(total / 25)) };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});

const searchOpts: SearchOpts = {
  jobage: 9999,
  page: 1,
  limit: 25,
  format: "json",
  includeDescription: true,
  specializations: [],
  sort: "date",
};

describe("runSearch (mocked fetch)", () => {
  test("emits the contract envelope with meta.count/page/total and the required result fields", async () => {
    mockFetch([{ path: "/jobs", status: 200, body: list([job()], 42) }]);
    const out = captureStdout();

    const code = await runSearch({ ...searchOpts, query: "product manager" });
    expect(code).toBe(0);

    const parsed = JSON.parse(out.get());
    expect(parsed.meta).toEqual({ count: 1, page: 1, total: 42, total_pages: 2 });
    expect(parsed.results).toHaveLength(1);
    const r = parsed.results[0];
    expect(r.id).toBe("25b71e5a-db28-43a2-84c0-1c7df875a547");
    expect(r.title).toBe("Product Manager, Mobile");
    expect(r.company).toBe("Stripe");
    expect(r.location).toBe("New York City, United States");
    expect(r.date).toBe("2026-09-16T10:52:18.948Z");
    expect(r.url).toMatch(/^https:\/\/entracareers\.com\/vacancies\/25b71e5a-db28-43a2-84c0-1c7df875a547/);
    expect(r.apply_url).toBe("https://stripe.com/jobs/search?gh_jid=8140438");
    expect(r.work_mode).toBe("remote");
    expect(r.description).toContain("About Stripe");
  });

  test("maps flags to the ENTRA query parameters", async () => {
    const mock = mockFetch([{ path: "/jobs", status: 200, body: list([job()]) }]);
    captureStdout();

    await runSearch({
      ...searchOpts,
      query: "ml engineer",
      workMode: "remote",
      experience: "3_6_years",
      employment: "full_time",
      specializations: ["data-engineer", "machine-learning-engineer"],
      salaryMin: 150000,
      sort: "salary",
      page: 2,
      limit: 10,
    });

    const url = mock.urls()[0];
    expect(new URL(url).pathname.endsWith("/jobs")).toBe(true);
    const p = params(url);
    expect(p.get("search")).toBe("ml engineer");
    expect(p.get("workLocation")).toBe("remote");
    expect(p.get("experienceLevel")).toBe("3_6_years");
    expect(p.get("employmentType")).toBe("full_time");
    expect(p.getAll("specializationSlugs")).toEqual(["data-engineer", "machine-learning-engineer"]);
    expect(p.get("salaryMin")).toBe("150000");
    expect(p.get("sortBy")).toBe("salary");
    expect(p.get("sortOrder")).toBe("desc");
    expect(p.get("page")).toBe("2");
    expect(p.get("limit")).toBe("10");
  });

  test("defaults to newest-first and omits unset filters", async () => {
    const mock = mockFetch([{ path: "/jobs", status: 200, body: list([]) }]);
    captureStdout();
    await runSearch({ ...searchOpts });
    const p = params(mock.urls()[0]);
    expect(p.get("sortBy")).toBe("publishedAt");
    expect(p.has("search")).toBe(false);
    expect(p.has("workLocation")).toBe(false);
    expect(p.has("salaryMin")).toBe(false);
  });

  test("applies the --jobage window client-side on the publication date", async () => {
    const fresh = job({ id: "11111111-1111-4111-8111-111111111111", publishedAt: new Date().toISOString() });
    const stale = job({ id: "22222222-2222-4222-8222-222222222222", publishedAt: "2024-05-13T00:00:00Z" });
    mockFetch([{ path: "/jobs", status: 200, body: list([fresh, stale], 2) }]);
    const out = captureStdout();

    await runSearch({ ...searchOpts, jobage: 14 });

    const parsed = JSON.parse(out.get());
    expect(parsed.results.map((r: { id: string }) => r.id)).toEqual([fresh.id]);
    expect(parsed.meta.count).toBe(1);
    expect(parsed.meta.total).toBe(2); // server-side match count, before client-side filters
  });

  test("applies --location as a case-insensitive substring filter on City, Country", async () => {
    const berlin = job({ id: "11111111-1111-4111-8111-111111111111", city: { nameEn: "Berlin" }, country: { nameEn: "Germany" } });
    const nyc = job({ id: "22222222-2222-4222-8222-222222222222" });
    mockFetch([{ path: "/jobs", status: 200, body: list([berlin, nyc]) }]);
    const out = captureStdout();

    await runSearch({ ...searchOpts, location: "germany" });

    const parsed = JSON.parse(out.get());
    expect(parsed.results.map((r: { id: string }) => r.id)).toEqual([berlin.id]);
  });

  test("strips description bodies when includeDescription is false", async () => {
    mockFetch([{ path: "/jobs", status: 200, body: list([job()]) }]);
    const out = captureStdout();
    await runSearch({ ...searchOpts, includeDescription: false });
    expect(JSON.parse(out.get()).results[0].description).toBeNull();
  });

  test("resolves --company through /companies and passes companyId to /jobs", async () => {
    const mock = mockFetch([
      { path: "/companies", status: 200, body: { data: [{ id: "c-1", name: "Stripe Labs", slug: "stripe-labs" }, { id: "c-2", name: "Stripe", slug: "stripe" }], total: 2, page: 1, limit: 10 } },
      { path: "/jobs", status: 200, body: list([job()]) },
    ]);
    captureStdout();

    const code = await runSearch({ ...searchOpts, company: "stripe" });
    expect(code).toBe(0);

    const [companiesUrl, jobsUrl] = mock.urls();
    expect(new URL(companiesUrl).pathname.endsWith("/companies")).toBe(true);
    expect(params(companiesUrl).get("search")).toBe("stripe");
    expect(params(jobsUrl).get("companyId")).toBe("c-2"); // exact slug match beats the first row
  });

  test("an unknown --company exits 1 with NOT_FOUND", async () => {
    mockFetch([{ path: "/companies", status: 200, body: { data: [], total: 0, page: 1, limit: 10 } }]);
    captureStdout();
    const err = captureStderr();
    const code = await runSearch({ ...searchOpts, company: "no-such-company" });
    expect(code).toBe(1);
    expect(JSON.parse(err.get()).code).toBe("NOT_FOUND");
  });

  test("a 5xx after retries exits 1 with SEARCH_FAILED on stderr", async () => {
    globalThis.fetch = (async () => new Response("oops", { status: 503 })) as unknown as typeof fetch;
    captureStdout();
    const err = captureStderr();
    const code = await runSearch({ ...searchOpts, query: "x" });
    expect(code).toBe(1);
    expect(JSON.parse(err.get()).code).toBe("SEARCH_FAILED");
  }, 60000);

  test("renders a table without the description", async () => {
    mockFetch([{ path: "/jobs", status: 200, body: list([job()]) }]);
    const out = captureStdout();
    await runSearch({ ...searchOpts, format: "table" });
    expect(out.get()).toMatch(/^ID\s+TITLE\s+COMPANY/);
    expect(out.get()).toContain("Product Manager, Mobile");
    expect(out.get()).not.toContain("About Stripe");
  });
});

describe("runDetail (mocked fetch)", () => {
  test("fetches /jobs/<id> and emits the detail shape", async () => {
    const mock = mockFetch([{ path: "/jobs/25b71e5a-db28-43a2-84c0-1c7df875a547", status: 200, body: { data: job({ requirements: "<ul><li>5+ years PM</li><li>Mobile</li></ul>" }) } }]);
    const out = captureStdout();

    const code = await runDetail({ id: "https://entracareers.com/us/vacancies/25b71e5a-db28-43a2-84c0-1c7df875a547?utm_source=x", format: "json" });
    expect(code).toBe(0);
    expect(new URL(mock.urls()[0]).pathname.endsWith("/jobs/25b71e5a-db28-43a2-84c0-1c7df875a547")).toBe(true);

    const parsed = JSON.parse(out.get());
    expect(parsed.id).toBe("25b71e5a-db28-43a2-84c0-1c7df875a547");
    expect(parsed.requirements).toBe("5+ years PM\nMobile");
    expect(parsed.specialization).toBe("Product Manager");
    expect(parsed.expires_at).toBe("2026-10-16T10:52:14.827Z");
    expect(parsed.is_active).toBe(true);
  });

  test("a 404 exits 1 with NOT_FOUND", async () => {
    mockFetch([]);
    captureStdout();
    const err = captureStderr();
    const code = await runDetail({ id: "25b71e5a-db28-43a2-84c0-1c7df875a547", format: "json" });
    expect(code).toBe(1);
    expect(JSON.parse(err.get()).code).toBe("NOT_FOUND");
  });

  test("plain output includes the apply link and id", async () => {
    mockFetch([{ path: "/jobs/", status: 200, body: { data: job() } }]);
    const out = captureStdout();
    await runDetail({ id: "25b71e5a-db28-43a2-84c0-1c7df875a547", format: "plain" });
    expect(out.get()).toContain("Apply: https://stripe.com/jobs/search?gh_jid=8140438");
    expect(out.get()).toContain("id: 25b71e5a-db28-43a2-84c0-1c7df875a547");
  });
});

describe("helpers", () => {
  test("normalizeId accepts a UUID or a vacancies URL and rejects the rest", () => {
    expect(normalizeId("25B71E5A-DB28-43A2-84C0-1C7DF875A547")).toBe("25b71e5a-db28-43a2-84c0-1c7df875a547");
    expect(normalizeId("https://entracareers.com/de/vacancies/25b71e5a-db28-43a2-84c0-1c7df875a547")).toBe("25b71e5a-db28-43a2-84c0-1c7df875a547");
    expect(normalizeId("https://entracareers.com/vacancies/25b71e5a-db28-43a2-84c0-1c7df875a547?utm_source=agent")).toBe("25b71e5a-db28-43a2-84c0-1c7df875a547");
    expect(normalizeId("8140438")).toBeNull();
    expect(normalizeId("")).toBeNull();
  });

  test("formatSalary renders a range with currency and period, null when unset", () => {
    expect(formatSalary(job({ salaryMin: 165000, salaryMax: 280000, salaryCurrency: "USD", salaryPeriod: "yearly" }))).toBe("USD 165000–280000/yr");
    expect(formatSalary(job({ salaryMin: 26, salaryMax: 32, salaryPeriod: "hourly" }))).toBe("USD 26–32/hr");
    expect(formatSalary(job({ salaryMin: 90000, salaryMax: null, salaryCurrency: "EUR", salaryPeriod: null }))).toBe("EUR 90000");
    expect(formatSalary(job())).toBeNull();
  });

  test("toResult never omits a contract field and nulls missing values", () => {
    const r = toResult(job({ company: null, city: null, country: null, publishedAt: null, externalApplyUrl: null, description: "" }));
    expect(r.company).toBeNull();
    expect(r.location).toBeNull();
    expect(r.date).toBeNull();
    expect(r.apply_url).toBeNull();
    expect(r.description).toBeNull();
    expect(Object.keys(r)).toEqual(expect.arrayContaining(["id", "title", "company", "location", "date", "url"]));
  });

  test("cleanHtml strips tags, decodes entities and keeps plain text intact", () => {
    expect(cleanHtml("<p>Build &amp; ship</p><ul><li>Go</li><li>K8s</li></ul>")).toBe("Build & ship\nGo\nK8s");
    expect(cleanHtml("Who we are\n\nAbout Stripe")).toBe("Who we are\n\nAbout Stripe");
    expect(cleanHtml("")).toBeNull();
  });

  test("withinDays keeps undated results and drops old ones", () => {
    const now = Date.parse("2026-09-19T00:00:00Z");
    expect(withinDays("2026-09-10T00:00:00Z", 14, now)).toBe(true);
    expect(withinDays("2026-08-01T00:00:00Z", 14, now)).toBe(false);
    expect(withinDays(null, 14, now)).toBe(true);
  });

  test("matchesLocation is a case-insensitive substring match", () => {
    expect(matchesLocation("New York City, United States", "united states")).toBe(true);
    expect(matchesLocation("Berlin, Germany", "Munich")).toBe(false);
    expect(matchesLocation(null, "Berlin")).toBe(false);
  });
});
