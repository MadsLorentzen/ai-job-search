import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

interface SearchJSON {
  meta: { count: number; page: number };
  results: Array<{ id: string; title: string; url: string }>;
}

describe("iimjobs CLI flag validation", () => {
  describe("NaN validation", () => {
    test("--jobage non-numeric exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-q", "data", "--jobage", "foo"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/jobage/);
    });

    test("--page non-numeric exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-q", "data", "--page", "abc"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/page/);
    });

    test("--limit non-numeric exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-q", "data", "--limit", "xyz"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/limit/);
    });
  });

  describe("required-input validation", () => {
    test("no query and no location exits 1 with NO_QUERY", async () => {
      const result = await runCLI(["search"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("NO_QUERY");
    });

    test("unknown location exits 1 with BAD_LOCATION", async () => {
      const result = await runCLI(["search", "-q", "data", "-l", "Atlantis"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_LOCATION");
    });
  });

  describe("detail validation", () => {
    test("missing id exits 1 with NO_ID", async () => {
      const result = await runCLI(["detail"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("NO_ID");
    });

    test("unparseable id exits 1 with BAD_ID", async () => {
      const result = await runCLI(["detail", "not-an-id", "--format", "plain"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ID");
    });
  });

  describe("live search (network)", () => {
    test("keyword search returns well-formed results", async () => {
      const result = await runCLI([
        "search",
        "-q",
        "business intelligence",
        "--limit",
        "3",
      ]);
      expect(result.exitCode).toBe(0);
      const json = parseJSON<SearchJSON>(result);
      expect(json.meta.page).toBe(1);
      expect(Array.isArray(json.results)).toBe(true);
      expect(json.results.length).toBeGreaterThan(0);
      const job = json.results[0];
      expect(job.id).toMatch(/^\d+$/);
      expect(job.title.length).toBeGreaterThan(0);
      expect(job.url).toContain("iimjobs.com");
    });
  });
});
