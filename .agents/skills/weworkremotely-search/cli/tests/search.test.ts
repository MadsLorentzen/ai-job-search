import { afterEach, describe, expect, test } from "bun:test";
import { runSearch } from "../src/commands/search";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;

function item(title: string, link: string, region = "Anywhere in the World"): string {
  return `<item>
    <title>${title}</title>
    <region>${region}</region>
    <category>Full-Stack Programming</category>
    <pubDate>${new Date().toUTCString()}</pubDate>
    <link>${link}</link>
    <guid>${link}</guid>
    <description>&lt;p&gt;Body&lt;/p&gt;</description>
  </item>`;
}

const FEED = `<rss><channel>
  ${item("Acme: Backend Engineer", "https://weworkremotely.com/remote-jobs/acme-backend-engineer")}
  ${item("Beta: Frontend Engineer", "https://weworkremotely.com/remote-jobs/beta-frontend-engineer", "US Only")}
</channel></rss>`;

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
  test("parses all items from the feed", async () => {
    stubFeed();
    const stdout = captureStdout();

    const code = await runSearch({ jobage: 9999, page: 1, format: "json" });

    expect(code).toBe(0);
    expect(JSON.parse(stdout.get()).results).toHaveLength(2);
  });

  test("--limit 0 emits zero results", async () => {
    stubFeed();
    const stdout = captureStdout();

    await runSearch({ jobage: 9999, page: 1, limit: 0, format: "json" });

    expect(JSON.parse(stdout.get()).results).toHaveLength(0);
  });

  test("query filters by title", async () => {
    stubFeed();
    const stdout = captureStdout();

    await runSearch({ query: "frontend", jobage: 9999, page: 1, format: "json" });

    const parsed = JSON.parse(stdout.get());
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].title).toBe("Frontend Engineer");
  });

  test("region filter narrows to matching entries", async () => {
    stubFeed();
    const stdout = captureStdout();

    await runSearch({ region: "US", jobage: 9999, page: 1, format: "json" });

    const parsed = JSON.parse(stdout.get());
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].company).toBe("Beta");
  });
});
