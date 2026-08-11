import { describe, expect, test } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// Live smoke test against the real Arbeitnow API/site. Keep this to one search + one detail
// fetch per run — see SKILL.md's personal-use note (the API's own terms ask not to abuse it).
describe("arbeitnow-cli live smoke test", () => {
  test("search returns real results with non-null id/title/url", async () => {
    const result = await runCLI(["search", "-q", "Product", "--limit", "5"]);
    const data = parseJSON<{ meta: { count: number }; results: Array<{ id: string; title: string; url: string }> }>(
      result,
    );
    expect(data.results.length).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.url).toContain("arbeitnow.com");
    }
  }, 30000);

  test("detail on a URL from search returns a readable description", async () => {
    const searchResult = await runCLI(["search", "--limit", "1"]);
    const searchData = parseJSON<{ results: Array<{ url: string }> }>(searchResult);
    const url = searchData.results[0]!.url;

    const detailResult = await runCLI(["detail", url]);
    const job = parseJSON<{ title: string; description: string | null }>(detailResult);
    expect(job.title).toBeTruthy();
    expect(job.description).toBeTruthy();
    expect(job.description).not.toContain("<p");
    expect(job.description).not.toContain("<div");
  }, 30000);
});
