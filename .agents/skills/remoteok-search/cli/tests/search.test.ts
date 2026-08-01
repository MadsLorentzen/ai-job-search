import { afterEach, describe, expect, test } from "bun:test";
import { runSearch } from "../src/commands/search";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;

const FEED = JSON.stringify([
  { legal: "attribution notice" },
  {
    id: "1",
    position: "Backend Engineer",
    company: "Acme",
    location: "",
    tags: ["node", "backend"],
    date: new Date().toISOString(),
    url: "https://remoteok.com/remote-jobs/1",
    apply_url: "https://remoteok.com/remote-jobs/1",
    salary_min: 0,
    salary_max: 0,
  },
  {
    id: "2",
    position: "Frontend Engineer",
    company: "Beta",
    location: "New York, USA",
    tags: ["react", "frontend"],
    date: new Date().toISOString(),
    url: "https://remoteok.com/remote-jobs/2",
    apply_url: "https://remoteok.com/remote-jobs/2",
    salary_min: 0,
    salary_max: 0,
  },
]);

function stubFeed() {
  globalThis.fetch = (async () => new Response(FEED, { status: 200 })) as unknown as typeof fetch;
}

function captureStdout(): { get: () => string } {
  let out = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  return { get: () => out };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
});

describe("runSearch", () => {
  test("drops the leading legal/attribution element from the feed", async () => {
    stubFeed();
    const stdout = captureStdout();

    const code = await runSearch({ jobage: 9999, page: 1, format: "json" });

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.get());
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results.every((r: { id: string }) => r.id !== undefined)).toBe(true);
  });

  test("--limit 0 emits zero results", async () => {
    stubFeed();
    const stdout = captureStdout();

    const code = await runSearch({ jobage: 9999, page: 1, limit: 0, format: "json" });

    expect(code).toBe(0);
    expect(JSON.parse(stdout.get()).results).toHaveLength(0);
  });

  test("query filters by title/tags", async () => {
    stubFeed();
    const stdout = captureStdout();

    await runSearch({ query: "frontend", jobage: 9999, page: 1, format: "json" });

    const parsed = JSON.parse(stdout.get());
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].title).toBe("Frontend Engineer");
  });

  test("location filter narrows to matching entries", async () => {
    stubFeed();
    const stdout = captureStdout();

    await runSearch({ location: "New York", jobage: 9999, page: 1, format: "json" });

    const parsed = JSON.parse(stdout.get());
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].company).toBe("Beta");
  });
});
