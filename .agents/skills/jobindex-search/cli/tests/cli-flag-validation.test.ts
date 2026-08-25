import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

// All cases fail schema validation (or the required-flag guard) before any
// network request, so the suite is network-free. Regression context: a bare
// z.coerce.number() accepted --limit=-1, and slice(0, -1) then silently
// dropped the last result instead of erroring. Filter flags (--jobage) also
// accepted negative and fractional values that were sent raw to the portal.

function expectValidationError(result: { exitCode: number; stdout: string; stderr: string }, option: string) {
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  const error = JSON.parse(result.stderr);
  expect(error.ok).toBe(false);
  expect(error.error.kind).toBe("validation");
  expect(error.error.option).toBe(option);
}

describe("Jobindex CLI flag validation", () => {
  test("--limit=-1 is rejected instead of silently dropping the last result", async () => {
    const result = await runCLI(["search", "--query", "test", "--limit=-1"]);
    expectValidationError(result, "limit");
    expect(JSON.parse(result.stderr).error.message).toContain("greater than or equal to 1");
  });

  test("--limit=0 is rejected", async () => {
    const result = await runCLI(["search", "--query", "test", "--limit=0"]);
    expectValidationError(result, "limit");
  });

  test("--limit=1.5 is rejected as non-integer", async () => {
    const result = await runCLI(["search", "--query", "test", "--limit=1.5"]);
    expectValidationError(result, "limit");
    expect(JSON.parse(result.stderr).error.message).toContain("Expected integer");
  });

  test("--page=0 is rejected on the 1-indexed portal", async () => {
    const result = await runCLI(["search", "--query", "test", "--page=0"]);
    expectValidationError(result, "page");
  });

  test("--jobage=-5 is rejected", async () => {
    const result = await runCLI(["search", "--query", "test", "--jobage=-5"]);
    expectValidationError(result, "jobage");
    expect(JSON.parse(result.stderr).error.message).toContain("greater than or equal to 1");
  });

  test("--jobage=1.5 is rejected as non-integer", async () => {
    const result = await runCLI(["search", "--query", "test", "--jobage=1.5"]);
    expectValidationError(result, "jobage");
    expect(JSON.parse(result.stderr).error.message).toContain("Expected integer");
  });

  test("valid numeric flags pass schema validation (proven offline via the required-flag guard)", async () => {
    const result = await runCLI(["search", "--page=2", "--limit=5"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "--query is required",
      code: "MISSING_REQUIRED",
    });
  });
});


describe("unknown flag rejection", () => {
  // add-portal.md's contract: "a bogus flag or missing required arg exits 1
  // with a JSON error on stderr". A silently discarded flag is worse than an
  // error: on jobdanmark a wrong flag name returned the entire database
  // (13,862 results) as if it matched the query (review finding F13,
  // 2026-08-19). Rejection happens before dispatch, so these are network-free.
  test("a bogus --flag exits 1 with a JSON error instead of being silently discarded", async () => {
    const result = await runCLI(["search", "--query", "test", "--bogus-flag", "xyz"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("UNKNOWN_FLAG");
    expect(error.error).toContain("--bogus-flag");
  });
});
