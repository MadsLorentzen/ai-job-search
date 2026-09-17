import { describe, expect, test } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// Live smoke tests — hit the real Hitmarker search backend. Kept minimal per
// the generator's "keep volume low" rule.

describe("Hitmarker CLI live search", () => {
  test("search returns real results with populated core fields", async () => {
    const result = await runCLI(["search", "-q", "Environment Artist", "--limit", "5", "--format", "json"]);
    const body = parseJSON<{ meta: { count: number }; results: any[] }>(result);
    expect(body.results.length).toBeGreaterThan(0);
    const first = body.results[0];
    expect(typeof first.id).toBe("string");
    expect(first.id.length).toBeGreaterThan(0);
    expect(typeof first.title).toBe("string");
    expect(first.title.length).toBeGreaterThan(0);
    expect(first.url).toContain("hitmarker.net/jobs/");
  });

  test("detail returns a readable description for a real posting", async () => {
    const search = await runCLI(["search", "-q", "Environment Artist", "--limit", "3", "--format", "json"]);
    const body = parseJSON<{ results: any[] }>(search);
    const id = body.results[0].id;

    const detail = await runCLI(["detail", id, "--format", "plain"]);
    expect(detail.exitCode).toBe(0);
    expect(detail.stdout.length).toBeGreaterThan(20);
    expect(detail.stdout).toContain("URL: https://hitmarker.net/jobs/");
  });
});
