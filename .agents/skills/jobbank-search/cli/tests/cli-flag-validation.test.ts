import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

// All cases fail schema validation (or the required-flag guard) before any
// network request, so the suite is network-free. Regression context: a bare
// z.coerce.number() accepted --limit=-1, and slice(0, -1) then silently
// dropped the last result instead of erroring. The --company filter flag
// also accepted negative and fractional values that were sent raw to the
// portal.

function expectValidationError(result: { exitCode: number; stdout: string; stderr: string }, option: string) {
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  const error = JSON.parse(result.stderr);
  expect(error.ok).toBe(false);
  expect(error.error.kind).toBe("validation");
  expect(error.error.option).toBe(option);
}

describe("Jobbank CLI flag validation", () => {
  test("search --limit=-1 is rejected instead of silently dropping the last result", async () => {
    const result = await runCLI(["search", "--key", "test", "--limit=-1"]);
    expectValidationError(result, "limit");
    expect(JSON.parse(result.stderr).error.message).toContain("greater than or equal to 1");
  });

  test("search --limit=0 is rejected", async () => {
    const result = await runCLI(["search", "--key", "test", "--limit=0"]);
    expectValidationError(result, "limit");
  });

  test("search --limit=1.5 is rejected as non-integer", async () => {
    const result = await runCLI(["search", "--key", "test", "--limit=1.5"]);
    expectValidationError(result, "limit");
    expect(JSON.parse(result.stderr).error.message).toContain("Expected integer");
  });

  test("search --company=-1 is rejected", async () => {
    const result = await runCLI(["search", "--key", "test", "--company=-1"]);
    expectValidationError(result, "company");
    expect(JSON.parse(result.stderr).error.message).toContain("greater than or equal to 1");
  });

  test("search --company=1.5 is rejected as non-integer", async () => {
    const result = await runCLI(["search", "--key", "test", "--company=1.5"]);
    expectValidationError(result, "company");
    expect(JSON.parse(result.stderr).error.message).toContain("Expected integer");
  });

  test("valid --limit passes schema validation (proven offline via the required-filter guard)", async () => {
    const result = await runCLI(["search", "--limit=5"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "--key or at least one filter is required",
      code: "MISSING_REQUIRED",
    });
  });
});
