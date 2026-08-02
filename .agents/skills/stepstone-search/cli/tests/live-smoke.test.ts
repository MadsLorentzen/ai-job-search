import { describe, expect, test } from "bun:test";
import { parseJSON, runCLI } from "./helpers";

// Live network smoke test against the real stepstone.de site — per /add-portal Step 4,
// a portal skill must not be registered without having returned real results at least
// once. Keep this test's volume low (one search, one detail fetch) so re-running the
// suite doesn't amount to a crawl.

describe("Stepstone live smoke test", () => {
  test("search returns real, complete results for a realistic query", async () => {
    const result = await runCLI([
      "search",
      "-q",
      "Machine Learning Engineer",
      "-l",
      "Stuttgart",
      "--limit",
      "5",
    ]);
    const body = parseJSON<{ meta: { count: number }; results: any[] }>(result);

    expect(body.results.length).toBeGreaterThan(0);
    const first = body.results[0];
    expect(typeof first.id).toBe("string");
    expect(first.id.length).toBeGreaterThan(0);
    expect(typeof first.title).toBe("string");
    expect(first.title.length).toBeGreaterThan(0);
    expect(first.url).toContain("stepstone.de");
  }, 30000);

  test("detail returns a readable description for a job found via search", async () => {
    const searchResult = await runCLI(["search", "-q", "Data Scientist", "-l", "Berlin", "--limit", "1"]);
    const { results } = parseJSON<{ results: { id: string }[] }>(searchResult);
    expect(results.length).toBeGreaterThan(0);

    const detailResult = await runCLI(["detail", results[0].id]);
    const job = parseJSON<{ title: string; description: string | null }>(detailResult);

    expect(job.title).not.toBe("(untitled)");
    expect(job.description).not.toBeNull();
    expect((job.description as string).length).toBeGreaterThan(50);
    expect(job.description).not.toMatch(/<[a-z][\s\S]*>/i);
  }, 30000);
});
