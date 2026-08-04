import { describe, expect, test } from "bun:test";
import { runCLI, parseJSON } from "./helpers.js";

const TEST_QUERY = "AI engineer";

describe("jobsdb-hk-search live smoke tests", () => {
  test("search returns real results", async () => {
    const result = await runCLI([
      "search",
      "-q",
      TEST_QUERY,
      "--limit",
      "5",
      "--format",
      "json",
    ]);
    expect(result.exitCode).toBe(0);
    const data = parseJSON<{ meta: { count: number }; results: Array<{ id: string; title: string; url: string }> }>(result);
    expect(data.results.length).toBeGreaterThanOrEqual(1);
    for (const r of data.results) {
      expect(r.id).toMatch(/^\d+$/);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.url).toContain("hk.jobsdb.com/job/");
    }
  });

  test("table format renders without crashing", async () => {
    const result = await runCLI([
      "search",
      "-q",
      TEST_QUERY,
      "--limit",
      "3",
      "--format",
      "table",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ID");
    expect(result.stdout).toContain("TITLE");
  });

  test("detail returns description for a real job", async () => {
    const search = await runCLI([
      "search",
      "-q",
      TEST_QUERY,
      "--limit",
      "1",
      "--format",
      "json",
    ]);
    const { results } = parseJSON<{ results: Array<{ id: string }> }>(search);
    const id = results[0].id;
    const detail = await runCLI(["detail", id, "--format", "plain"]);
    expect(detail.exitCode).toBe(0);
    expect(detail.stdout.length).toBeGreaterThan(50);
  });

  test("missing query exits with JSON error on stderr", async () => {
    const result = await runCLI(["search"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('"error"');
  });

  test("unknown flag exits with an error", async () => {
    const result = await runCLI(["search", "-q", TEST_QUERY, "--bogus"]);
    expect(result.exitCode).toBe(1);
  });
});
