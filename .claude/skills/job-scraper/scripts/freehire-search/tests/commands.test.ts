import { afterEach, describe, expect, test } from "bun:test";
import { runSearch } from "../src/commands/search";
import { runDetail } from "../src/commands/detail";
import type { FreehireJob } from "../src/helpers";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;

function captureStdout(): { get: () => string } {
  let buf = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  return { get: () => buf };
}

function mockFetch(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

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
    description: "<p>Build things</p>",
    skills: ["go"],
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

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
});

const searchOpts = {
  jobage: 9999,
  page: 1,
  limit: 25,
  format: "json" as const,
  regions: [] as string[],
  countries: [] as string[],
  cities: [] as string[],
  seniority: [] as string[],
  category: [] as string[],
  skills: [] as string[],
  facets: {} as Record<string, string[]>,
};

describe("runSearch (mocked fetch)", () => {
  test("emits the contract envelope with meta.count/page/total", async () => {
    mockFetch(200, { data: [job()], meta: { total: 42, limit: 25, offset: 0 } });
    const out = captureStdout();

    const code = await runSearch({ ...searchOpts, query: "backend" });
    expect(code).toBe(0);

    const parsed = JSON.parse(out.get());
    expect(parsed.meta).toEqual({ count: 1, page: 1, total: 42 });
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].id).toBe("backend-engineer-acme-ab12cd34");
    expect(parsed.results[0].date).toBe("2026-07-06T00:00:00Z");
  });

  test("empty result set yields an empty results array", async () => {
    mockFetch(200, { data: [], meta: { total: 0 } });
    const out = captureStdout();

    const code = await runSearch({ ...searchOpts, query: "nothing-matches-xyz" });
    expect(code).toBe(0);
    expect(JSON.parse(out.get()).results).toHaveLength(0);
  });

  test("network failure exits 1 with SEARCH_FAILED", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    let err = "";
    const origErr = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      err += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    const code = await runSearch({ ...searchOpts, query: "backend" });
    process.stderr.write = origErr;

    expect(code).toBe(1);
    expect(JSON.parse(err).code).toBe("SEARCH_FAILED");
  });
});

describe("runDetail (mocked fetch)", () => {
  test("prints the reshaped detail with a cleaned description", async () => {
    mockFetch(200, { data: job() });
    const out = captureStdout();

    const code = await runDetail({ id: "backend-engineer-acme-ab12cd34", format: "json" });
    expect(code).toBe(0);

    const parsed = JSON.parse(out.get());
    expect(parsed.id).toBe("backend-engineer-acme-ab12cd34");
    expect(parsed.description).toBe("Build things");
    expect(parsed.cities).toEqual(["Berlin"]);
  });

  test("404 exits 1 with NOT_FOUND", async () => {
    mockFetch(404, { error: "not found" });
    let err = "";
    const origErr = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      err += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    const code = await runDetail({ id: "does-not-exist", format: "json" });
    process.stderr.write = origErr;

    expect(code).toBe(1);
    expect(JSON.parse(err).code).toBe("NOT_FOUND");
  });
});
