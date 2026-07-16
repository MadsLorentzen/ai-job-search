import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

function parseError(stderr: string): { error: string; code: string } {
  return JSON.parse(stderr);
}

describe("Jobnet CLI error contract", () => {
  test("detail without an ID exits 1 with MISSING_REQUIRED", async () => {
    const result = await runCLI(["detail"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(parseError(result.stderr)).toEqual({
      error: "Job ad ID is required",
      code: "MISSING_REQUIRED",
    });
  });

  test("search with valid flags passes validation", async () => {
    const result = await runCLI([
      "search", "--search-string", "python", "--per-page", "1",
    ]);
    const errStr = result.stderr;
    let err: { code?: string } = {};
    try { err = JSON.parse(errStr); } catch {}
    expect(err.code).not.toBe("BAD_ARG");
  });

  test("--per-page NaN exits 1", async () => {
    const result = await runCLI(["search", "--per-page", "abc"]);
    expect(result.exitCode).not.toBe(0);
  });

  test("--page NaN exits 1", async () => {
    const result = await runCLI(["search", "--page", "xyz"]);
    expect(result.exitCode).not.toBe(0);
  });

  test("--radius NaN exits 1", async () => {
    const result = await runCLI(["search", "--postal-code", "2100", "--radius", "foo"]);
    expect(result.exitCode).not.toBe(0);
  });

  test("--limit NaN exits 1", async () => {
    const result = await runCLI(["search", "--limit", "bar"]);
    expect(result.exitCode).not.toBe(0);
  });
});
