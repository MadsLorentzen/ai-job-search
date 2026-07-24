import { afterEach, describe, expect, test } from "bun:test";
import { runSearch, buildFacetFilters, windowSize, type SearchOpts } from "../src/commands/search";
import type { WkHit } from "../src/helpers";

// The search pipeline with the network mocked: what we send to Algolia, and what
// we make of what comes back. Offline, so CI covers it; the live suite in
// commands.test.ts (opt-in) covers reachability.

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
});

function captureStdout(): { get: () => string } {
  let buf = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  return { get: () => buf };
}

/** Mock both calls the CLI makes: the credential page, then the Algolia query. */
function mockPortal(hits: WkHit[], nbHits = hits.length): { body: () => Record<string, unknown> } {
  let sent: Record<string, unknown> = {};
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = url.toString();
    if (href.includes("jobs.stationf.co")) {
      return new Response(
        `<script>window.legacyEnv = { algoliaAppId: "APP", algoliaIndexSuffix: "production_careers" }</script>
         <input type="hidden" id="algolia_api_key" value="KEY" />`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    sent = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ hits, nbHits }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { body: () => sent };
}

function opts(overrides: Partial<SearchOpts> = {}): SearchOpts {
  return {
    jobage: 9999,
    page: 1,
    limit: 20,
    format: "json",
    sort: "relevance",
    cities: [],
    regions: [],
    countries: [],
    contracts: [],
    remote: [],
    departments: [],
    companies: [],
    languages: [],
    facets: {},
    ...overrides,
  };
}

function hit(overrides: Partial<WkHit> = {}): WkHit {
  return {
    slug: "backend-engineer_paris",
    name: "Backend Engineer",
    reference: "ACME_1",
    published_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    contract_type: "FULL_TIME",
    contract_type_names: { fr: "CDI" },
    remote: "partial",
    office: { city: "Paris", country: "France" },
    organization: { name: "Acme", slug: "acme" },
    ...overrides,
  };
}

describe("query construction", () => {
  test("facet groups AND across attributes and OR within one", () => {
    expect(buildFacetFilters(opts({ cities: ["Paris", "Lyon"], contracts: ["FULL_TIME"] }))).toEqual([
      ["offices.city:Paris", "offices.city:Lyon"],
      ["contract_type:FULL_TIME"],
    ]);
  });

  test("unset filters produce no facetFilters at all", () => {
    expect(buildFacetFilters(opts())).toEqual([]);
  });

  test("the --facet escape hatch reaches arbitrary attributes", () => {
    expect(buildFacetFilters(opts({ facets: { education_level: ["BAC_5"] } }))).toEqual([
      ["education_level:BAC_5"],
    ]);
  });

  test("recency modes widen the client-side window (no date replica on this board)", () => {
    expect(windowSize(opts({ limit: 5 }))).toBe(20);
    expect(windowSize(opts({ limit: 5, jobage: 14 }))).toBeGreaterThanOrEqual(100);
    expect(windowSize(opts({ limit: 5, sort: "date" }))).toBeGreaterThanOrEqual(100);
    expect(windowSize(opts({ limit: 400 }))).toBe(1000); // Algolia's cap
  });

  test("--page offsets by --limit, not by the widened window", async () => {
    const portal = mockPortal([hit()]);
    const out = captureStdout();
    await runSearch(opts({ page: 3, limit: 10 }));
    expect(portal.body().offset).toBe(20);
    expect(JSON.parse(out.get()).meta.page).toBe(3);
  });
});

describe("response handling", () => {
  test("emits the contract JSON shape", async () => {
    mockPortal([hit()], 42);
    const out = captureStdout();
    const code = await runSearch(opts());
    expect(code).toBe(0);
    const body = JSON.parse(out.get());
    expect(body.meta).toMatchObject({ count: 1, page: 1, total: 42 });
    expect(body.results[0]).toMatchObject({
      id: "acme/backend-engineer_paris",
      title: "Backend Engineer",
      company: "Acme",
      location: "Paris, France",
      contract: "CDI",
    });
  });

  test("--jobage drops older postings and keeps recent ones", async () => {
    mockPortal([
      hit({ reference: "NEW", published_at: new Date(Date.now() - 86400000).toISOString() }),
      hit({ reference: "OLD", slug: "old_paris", published_at: "2020-01-01T00:00:00.000Z" }),
    ]);
    const out = captureStdout();
    await runSearch(opts({ jobage: 7 }));
    const body = JSON.parse(out.get());
    expect(body.results).toHaveLength(1);
    expect(body.results[0].reference).toBe("NEW");
  });

  test("a posting with no date is excluded by --jobage rather than assumed recent", async () => {
    mockPortal([hit({ published_at: null })]);
    const out = captureStdout();
    await runSearch(opts({ jobage: 7 }));
    expect(JSON.parse(out.get()).results).toHaveLength(0);
  });

  test("--sort date orders newest first across mixed UTC offsets", async () => {
    mockPortal([
      hit({ reference: "A", slug: "a_paris", published_at: "2026-07-10T20:00:00.000+02:00" }), // 18:00Z
      hit({ reference: "B", slug: "b_paris", published_at: "2026-07-10T19:00:00.000Z" }),
    ]);
    const out = captureStdout();
    await runSearch(opts({ sort: "date" }));
    expect(JSON.parse(out.get()).results.map((r: { reference: string }) => r.reference)).toEqual(["B", "A"]);
  });

  test("--limit truncates and flags it", async () => {
    mockPortal([hit({ reference: "A" }), hit({ reference: "B", slug: "b_paris" })]);
    const out = captureStdout();
    await runSearch(opts({ limit: 1 }));
    const body = JSON.parse(out.get());
    expect(body.results).toHaveLength(1);
    expect(body.meta.truncated).toBe(true);
  });

  test("an unusable hit is skipped, not emitted with a broken URL", async () => {
    mockPortal([hit(), hit({ reference: "X", organization: null })]);
    const out = captureStdout();
    await runSearch(opts());
    const body = JSON.parse(out.get());
    expect(body.results).toHaveLength(1);
  });

  test("an Algolia error exits 1 with a JSON error on stderr, nothing on stdout", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const href = url.toString();
      if (href.includes("jobs.stationf.co")) {
        return new Response('<input id="algolia_api_key" value="KEY" />', { status: 200 });
      }
      return new Response(JSON.stringify({ message: "Index not allowed with this API key" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const stderrChunks: string[] = [];
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(chunk.toString());
      return true;
    }) as typeof process.stderr.write;
    const out = captureStdout();

    const code = await runSearch(opts());
    process.stderr.write = originalStderrWrite;

    expect(code).toBe(1);
    expect(out.get()).toBe("");
    const err = JSON.parse(stderrChunks.join(""));
    expect(err.code).toBe("SEARCH_FAILED");
    expect(err.error).toMatch(/Index not allowed/);
  });

  test("table format renders a header and no results line for an empty set", async () => {
    mockPortal([]);
    const out = captureStdout();
    await runSearch(opts({ format: "table" }));
    expect(out.get().trim()).toBe("Aucun résultat.");
  });
});
