import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildPayload, runSearch, type SearchOpts } from "../src/commands/search";
import { runDetail } from "../src/commands/detail";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;
const originalKey = process.env.FIRECRAWL_API_KEY;

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

/** Mock fetch and record the request body the CLI sent. */
function mockFetch(status: number, body: unknown): { payload: () => Record<string, unknown> } {
  let sent: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body ?? "{}"));
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { payload: () => sent };
}

function searchOpts(overrides: Partial<SearchOpts> = {}): SearchOpts {
  return {
    query: "data engineer",
    page: 1,
    limit: 10,
    format: "json",
    sites: [],
    excludeSites: [],
    enrich: true,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.FIRECRAWL_API_KEY = "fc-test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
  if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
  else process.env.FIRECRAWL_API_KEY = originalKey;
});

describe("buildPayload", () => {
  test("requests per-result extraction when enrichment is on", () => {
    const payload = buildPayload(searchOpts({ enrich: true }), 10);
    const scrapeOptions = payload.scrapeOptions as { formats: Array<{ type: string }> };
    expect(scrapeOptions.formats[0].type).toBe("json");
    expect(payload.sources).toEqual(["web"]);
    expect(payload.limit).toBe(10);
  });

  test("omits scrapeOptions entirely with --no-enrich (the cheap path)", () => {
    const payload = buildPayload(searchOpts({ enrich: false }), 10);
    expect(payload.scrapeOptions).toBeUndefined();
  });

  test("maps --jobage to a tbs bucket and --site to includeDomains", () => {
    const payload = buildPayload(searchOpts({ jobage: 14, sites: ["jobindex.dk"] }), 10);
    expect(payload.tbs).toBe("qdr:m");
    expect(payload.includeDomains).toEqual(["jobindex.dk"]);
    expect(payload.excludeDomains).toBeUndefined();
  });

  test("sends excludeDomains only when no --site filter is set", () => {
    // The API rejects both filters in one request, so only one may ever be sent.
    const both = buildPayload(searchOpts({ sites: ["a.com"], excludeSites: ["b.com"] }), 10);
    expect(both.includeDomains).toEqual(["a.com"]);
    expect(both.excludeDomains).toBeUndefined();

    const only = buildPayload(searchOpts({ excludeSites: ["b.com"] }), 10);
    expect(only.excludeDomains).toEqual(["b.com"]);
  });

  test("omits recency and geo params when unset", () => {
    const payload = buildPayload(searchOpts(), 10);
    expect(payload.tbs).toBeUndefined();
    expect(payload.country).toBeUndefined();
    expect(payload.location).toBeUndefined();
  });
});

describe("runSearch", () => {
  test("emits the contract JSON shape and reports credits used", async () => {
    mockFetch(200, {
      success: true,
      creditsUsed: 17,
      data: {
        web: [
          {
            url: "https://example.com/jobs/1",
            title: "Data Engineer",
            description: "snippet",
            json: { company: "Acme", location: "Berlin", date_posted: "2026-07-06" },
          },
        ],
      },
    });
    const out = captureStdout();
    const code = await runSearch(searchOpts());
    expect(code).toBe(0);

    const parsed = JSON.parse(out.get());
    expect(parsed.meta).toEqual({ count: 1, page: 1, total: 1, enriched: true, credits_used: 17 });
    expect(parsed.results[0]).toMatchObject({
      id: "https://example.com/jobs/1",
      title: "Data Engineer",
      company: "Acme",
      location: "Berlin",
      date: "2026-07-06",
      url: "https://example.com/jobs/1",
    });
  });

  test("returns page 2 by slicing an over-fetched result set", async () => {
    // Firecrawl search has no offset param, so page 2 asks for page*limit results
    // and returns the second window.
    const web = Array.from({ length: 4 }, (_, i) => ({
      url: `https://example.com/jobs/${i + 1}`,
      title: `Job ${i + 1}`,
    }));
    const mock = mockFetch(200, { success: true, data: { web } });
    const out = captureStdout();
    const code = await runSearch(searchOpts({ page: 2, limit: 2 }));
    expect(code).toBe(0);
    expect(mock.payload().limit).toBe(4);

    const parsed = JSON.parse(out.get());
    expect(parsed.results.map((r: { title: string }) => r.title)).toEqual(["Job 3", "Job 4"]);
    expect(parsed.meta.page).toBe(2);
  });

  test("refuses a window Firecrawl search cannot serve", async () => {
    const err = captureStderr();
    const code = await runSearch(searchOpts({ page: 20, limit: 10 }));
    expect(code).toBe(1);
    expect(JSON.parse(err.get()).code).toBe("BAD_ARG");
  });

  test("surfaces an API validation error on stderr and exits 1", async () => {
    mockFetch(400, { success: false, error: "Invalid request body", details: [{ path: ["limit"] }] });
    const err = captureStderr();
    const code = await runSearch(searchOpts());
    expect(code).toBe(1);
    const parsed = JSON.parse(err.get());
    expect(parsed.code).toBe("SEARCH_FAILED");
    expect(parsed.error).toContain("Invalid request body");
    // The details array names the offending field - keep it in the message.
    expect(parsed.error).toContain("limit");
  });

  test("renders a table without truncating the URL (it is the detail lookup key)", async () => {
    const url = "https://example.com/a-very-long-job-posting-path/that-keeps-going/12345678";
    mockFetch(200, { success: true, data: { web: [{ url, title: "Data Engineer" }] } });
    const out = captureStdout();
    const code = await runSearch(searchOpts({ format: "table" }));
    expect(code).toBe(0);
    expect(out.get()).toContain(url);
  });

  test("reports an empty result set as No results in table format", async () => {
    mockFetch(200, { success: true, data: { web: [] } });
    const out = captureStdout();
    expect(await runSearch(searchOpts({ format: "table" }))).toBe(0);
    expect(out.get().trim()).toBe("No results.");
  });
});

describe("runDetail", () => {
  test("scrapes the posting and returns markdown plus the extracted fields", async () => {
    const mock = mockFetch(200, {
      success: true,
      data: {
        markdown: "# Data Engineer\n\nWe are hiring.",
        json: { company: "Acme", location: "Copenhagen", deadline: "2026-08-01" },
        metadata: { sourceURL: "https://example.com/jobs/1", title: "Data Engineer" },
      },
    });
    const out = captureStdout();
    const code = await runDetail({ id: "https://example.com/jobs/1", format: "json" });
    expect(code).toBe(0);
    expect(mock.payload().url).toBe("https://example.com/jobs/1");

    const parsed = JSON.parse(out.get());
    expect(parsed.description).toBe("# Data Engineer\n\nWe are hiring.");
    expect(parsed.company).toBe("Acme");
    expect(parsed.deadline).toBe("2026-08-01");
  });

  test("rejects an unusable id before making a request", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const err = captureStderr();
    const code = await runDetail({ id: "not-a-url", format: "json" });
    expect(code).toBe(1);
    expect(called).toBe(false);
    expect(JSON.parse(err.get()).code).toBe("BAD_ID");
  });

  test("exits 1 with NO_API_KEY when the key is missing", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    const err = captureStderr();
    const code = await runDetail({ id: "https://example.com/jobs/1", format: "json" });
    expect(code).toBe(1);
    expect(JSON.parse(err.get()).error).toContain("FIRECRAWL_API_KEY");
  });
});
