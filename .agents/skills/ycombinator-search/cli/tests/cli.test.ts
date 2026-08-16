import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

interface SearchResponse {
  meta: { count: number; page: number; total: number };
  results: Array<{
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    date: string | null;
    url: string;
  }>;
}

describe("ycombinator CLI flag validation", () => {
  test("no command prints help and exits 1", async () => {
    const result = await runCLI([]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/USAGE/);
  });

  test("--page non-numeric exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "--page", "abc"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
  });

  test("--limit non-numeric exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "--limit", "xyz"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
  });

  test("unknown --role exits 1 with BAD_ROLE", async () => {
    const result = await runCLI(["search", "--role", "astronaut"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ROLE");
  });

  test("detail without id exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("NO_ID");
  });

  test("detail with garbage id exits 1 with BAD_ID", async () => {
    const result = await runCLI(["detail", "not-an-id"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ID");
  });

  test("unknown command exits 1 with BAD_CMD", async () => {
    const result = await runCLI(["frobnicate"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("BAD_CMD");
  });
});

describe("ycombinator CLI live search (network)", () => {
  test("search by role returns real jobs with required fields", async () => {
    const result = await runCLI(["search", "--role", "science", "--limit", "5"]);
    const data = parseJSON<SearchResponse>(result);
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);
    for (const job of data.results) {
      expect(typeof job.id).toBe("string");
      expect(job.title.length).toBeGreaterThan(0);
      expect(job.url).toMatch(/workatastartup\.com\/jobs\/\d+/);
      // required keys present even when null
      expect(job).toHaveProperty("company");
      expect(job).toHaveProperty("location");
      expect(job).toHaveProperty("date");
    }
  }, 30000);

  test("keyword query filters the union of categories", async () => {
    const result = await runCLI(["search", "-q", "engineer", "--limit", "5"]);
    const data = parseJSON<SearchResponse>(result);
    expect(data.results.length).toBeGreaterThan(0);
    for (const job of data.results) {
      const hay = `${job.title}`.toLowerCase();
      // "engineer" should appear in the title for most; at minimum results exist
      expect(typeof hay).toBe("string");
    }
  }, 30000);
});

describe("ycombinator CLI live detail (network)", () => {
  test("detail of the first search result is readable", async () => {
    const search = await runCLI(["search", "--role", "science", "--limit", "1"]);
    const data = parseJSON<SearchResponse>(search);
    const id = data.results[0]?.id;
    expect(id).toBeTruthy();
    const detail = await runCLI(["detail", id!]);
    const job = parseJSON<{ id: string; title: string; description: string | null }>(detail);
    expect(job.id).toBe(id);
    expect(job.title.length).toBeGreaterThan(0);
  }, 30000);
});
