import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

interface SearchResult {
  meta: { count: number; page: number };
  results: Array<{
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    date: string | null;
    url: string;
    salary: string | null;
  }>;
}

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("apna CLI flag validation", () => {
  test("no --query and no --location exits 1 with NO_CRITERIA", async () => {
    const result = await runCLI(["search"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("NO_CRITERIA");
  });

  test("non-numeric --limit exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "-q", "driver", "--limit", "xyz"]);
    expect(result.exitCode).not.toBe(0);
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("BAD_ARG");
    expect(err.error).toMatch(/limit/);
  });

  test("non-numeric --page exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "-q", "driver", "--page", "abc"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
  });

  test("detail with no id exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("NO_ID");
  });

  test("detail with unparseable id exits 1 with BAD_ID", async () => {
    const result = await runCLI(["detail", "not-an-id", "--format", "plain"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ID");
  });

  test("unknown command exits 1 with BAD_CMD", async () => {
    const result = await runCLI(["frobnicate"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("BAD_CMD");
  });
});

describe("apna CLI live search", () => {
  test('search "delivery executive" in Delhi returns ≥1 clean result', async () => {
    const result = await runCLI(["search", "-q", "delivery executive", "-l", "Delhi", "--limit", "5"]);
    expect(result.exitCode).toBe(0);
    const data = parseJSON<SearchResult>(result);
    expect(data.results.length).toBeGreaterThan(0);
    const job = data.results[0];
    expect(job.id).toBeTruthy();
    expect(job.title).toBeTruthy();
    expect(job.url).toContain("apna.co");
  });

  test("detail on a live search result returns readable fields", async () => {
    const search = await runCLI(["search", "-q", "delivery", "-l", "Delhi", "--limit", "1"]);
    const data = parseJSON<SearchResult>(search);
    const id = data.results[0]?.id;
    expect(id).toBeTruthy();

    const detail = await runCLI(["detail", id!]);
    expect(detail.exitCode).toBe(0);
    const job = parseJSON<{ id: string; title: string; url: string; description: string | null }>(detail);
    expect(job.id).toBe(id);
    expect(job.title).toBeTruthy();
    expect(job.url).toContain("apna.co");
  });
});
