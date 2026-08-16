import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

interface SearchResult {
  meta: { count: number; scannedPages: number };
  results: Array<{
    id: string;
    title: string;
    company: string | null;
    location: string;
    url: string;
  }>;
}

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("himalayas CLI live smoke", () => {
  test("search with no filters returns results", async () => {
    const result = await runCLI(["search", "--pages", "1", "--limit", "5"]);
    const data = parseJSON<SearchResult>(result);
    expect(data.results.length).toBeGreaterThan(0);
    const first = data.results[0];
    expect(first.id).toContain("/");
    expect(first.title).toBeTruthy();
    expect(first.url).toContain("himalayas.app");
  }, 30000);

  test("detail of the first search result is readable", async () => {
    const search = await runCLI(["search", "--pages", "1", "--limit", "1"]);
    const data = parseJSON<SearchResult>(search);
    const id = data.results[0].id;
    const detail = await runCLI(["detail", id, "--pages", "1"]);
    const job = parseJSON<{ description: string | null; title: string }>(detail);
    expect(job.title).toBeTruthy();
  }, 30000);
});

describe("himalayas CLI flag validation", () => {
  test("non-numeric --limit exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "--limit", "xyz"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
  });

  test("non-numeric --pages exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "--pages", "xyz"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
  });

  test("detail with no id exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("NO_ID");
  });

  test("detail with unknown id exits 1 with NOT_FOUND", async () => {
    const result = await runCLI(["detail", "not-a-real-company/not-a-real-job", "--pages", "1"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("NOT_FOUND");
  });
});
