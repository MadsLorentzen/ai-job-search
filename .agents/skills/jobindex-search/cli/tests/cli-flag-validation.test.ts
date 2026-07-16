import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("Jobindex CLI flag validation", () => {
  describe("search missing --query", () => {
    test("search without --query exits 1 with MISSING_REQUIRED", async () => {
      const result = await runCLI(["search"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("MISSING_REQUIRED");
      expect(err.error).toMatch(/query/);
    });
  });

  describe("detail missing ID", () => {
    test("detail without an ID exits 1 with MISSING_REQUIRED", async () => {
      const result = await runCLI(["detail"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("MISSING_REQUIRED");
    });
  });

  describe("--page NaN validation", () => {
    test("non-numeric string exits 1", async () => {
      const result = await runCLI(["search", "-q", "python", "--page", "abc"]);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("--limit NaN validation", () => {
    test("non-numeric string exits 1", async () => {
      const result = await runCLI(["search", "-q", "python", "--limit", "xyz"]);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("--jobage NaN validation", () => {
    test("non-numeric string exits 1", async () => {
      const result = await runCLI(["search", "-q", "python", "--jobage", "foo"]);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("valid flags produce no error", () => {
    test("all valid flags pass validation", async () => {
      const result = await runCLI([
        "search", "-q", "python", "--page", "1", "--limit", "1", "--jobage", "7",
      ]);
      const err = parsedStderr(result.stderr);
      expect(err.code).not.toBe("MISSING_REQUIRED");
    });
  });
});
