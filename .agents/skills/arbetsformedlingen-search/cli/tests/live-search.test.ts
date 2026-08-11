import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// Live smoke test against the real JobSearch API (no auth, low volume: one
// search + one detail lookup). Skippable via `LIVE=0 bun test` in CI/offline.
const LIVE = process.env.LIVE !== "0";
const describeLive = LIVE ? describe : describe.skip;

describeLive("live: search + detail", () => {
  test("search for the test query returns real, complete results", async () => {
    const result = await runCLI(["search", "-q", "forskningsingenjör", "--limit", "5", "--format", "json"]);
    const data = parseJSON<{ meta: { count: number; total: number }; results: Array<Record<string, unknown>> }>(result);

    expect(result.exitCode).toBe(0);
    expect(data.results.length).toBeGreaterThan(0);
    const first = data.results[0];
    expect(first.id).toBeTruthy();
    expect(first.title).toBeTruthy();
    expect(String(first.url)).toContain("arbetsformedlingen.se");
  });

  test("detail on a real id from search returns a readable description", async () => {
    const searchResult = await runCLI(["search", "-q", "forskningsingenjör", "--limit", "1", "--format", "json"]);
    const searchData = parseJSON<{ results: Array<{ id: string }> }>(searchResult);
    expect(searchData.results.length).toBeGreaterThan(0);
    const id = searchData.results[0].id;

    const detailResult = await runCLI(["detail", id, "--format", "plain"]);
    expect(detailResult.exitCode).toBe(0);
    expect(detailResult.stdout.length).toBeGreaterThan(50);
    expect(detailResult.stdout).not.toMatch(/<[a-z]+>/i); // no leftover HTML tags
  });
});
