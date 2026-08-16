import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

interface SearchOut {
  meta: { count: number; page: number; total: number | null; hasMore: boolean };
  results: Array<{
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    date: string | null;
    url: string | null;
  }>;
}

describe("protocoljobs CLI flag validation", () => {
  test("--jobage non-numeric exits 1 with BAD_ARG", async () => {
    const r = await runCLI(["search", "--jobage", "foo"]);
    expect(r.exitCode).not.toBe(0);
    expect(parsedStderr(r.stderr).code).toBe("BAD_ARG");
  });

  test("--page non-numeric exits 1 with BAD_ARG", async () => {
    const r = await runCLI(["search", "--page", "abc"]);
    expect(r.exitCode).not.toBe(0);
    expect(parsedStderr(r.stderr).code).toBe("BAD_ARG");
  });

  test("--limit non-numeric exits 1 with BAD_ARG", async () => {
    const r = await runCLI(["search", "--limit", "xyz"]);
    expect(r.exitCode).not.toBe(0);
    expect(parsedStderr(r.stderr).code).toBe("BAD_ARG");
  });

  test("unknown command exits 1 with BAD_CMD", async () => {
    const r = await runCLI(["frobnicate"]);
    expect(r.exitCode).not.toBe(0);
    expect(parsedStderr(r.stderr).code).toBe("BAD_CMD");
  });

  test("detail with no id exits 1 with NO_ID", async () => {
    const r = await runCLI(["detail"]);
    expect(r.exitCode).not.toBe(0);
    expect(parsedStderr(r.stderr).code).toBe("NO_ID");
  });

  test("detail with unparseable id exits 1 with BAD_ID", async () => {
    const r = await runCLI(["detail", "not-an-id"]);
    expect(r.exitCode).not.toBe(0);
    expect(parsedStderr(r.stderr).code).toBe("BAD_ID");
  });
});

describe("protocoljobs CLI live search", () => {
  test("search returns well-formed results with real fields", async () => {
    const r = await runCLI(["search", "-q", "data analyst", "--limit", "5"]);
    const out = parseJSON<SearchOut>(r);
    expect(Array.isArray(out.results)).toBe(true);
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results.length).toBeLessThanOrEqual(5);
    expect(out.meta.count).toBe(out.results.length);
    for (const job of out.results) {
      expect(typeof job.id).toBe("string");
      expect(job.id.length).toBeGreaterThan(0);
      expect(typeof job.title).toBe("string");
      expect(job.title.length).toBeGreaterThan(0);
    }
  });

  test("detail on a live id returns a description", async () => {
    const search = await runCLI(["search", "-q", "data analyst", "--limit", "1"]);
    const out = parseJSON<SearchOut>(search);
    const id = out.results[0]?.id;
    expect(id).toBeTruthy();
    const r = await runCLI(["detail", id as string, "--format", "plain"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(50);
  });
});
