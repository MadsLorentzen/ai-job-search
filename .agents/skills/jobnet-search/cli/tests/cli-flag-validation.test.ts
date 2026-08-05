import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

// All cases fail schema validation (or the required-flag guard) before any
// network request, so the suite is network-free. Regression context: a bare
// z.coerce.number() accepted --limit=-1 / --per-page=-1, and slice(0, -1)
// then silently dropped the last result instead of erroring. The --radius
// filter flag also accepted negative and fractional values that were sent
// raw to the portal.

function expectValidationError(result: { exitCode: number; stdout: string; stderr: string }, option: string) {
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  const error = JSON.parse(result.stderr);
  expect(error.ok).toBe(false);
  expect(error.error.kind).toBe("validation");
  expect(error.error.option).toBe(option);
}

describe("Jobnet CLI flag validation", () => {
  test("search --limit=-1 is rejected instead of silently dropping the last result", async () => {
    const result = await runCLI(["search", "--limit=-1"]);
    expectValidationError(result, "limit");
    expect(JSON.parse(result.stderr).error.message).toContain("greater than or equal to 1");
  });

  test("search --page=0 is rejected on the 1-indexed API", async () => {
    const result = await runCLI(["search", "--page=0"]);
    expectValidationError(result, "page");
  });

  test("search --per-page=-5 is rejected", async () => {
    const result = await runCLI(["search", "--per-page=-5"]);
    expectValidationError(result, "per-page");
  });

  test("search --limit=1.5 is rejected as non-integer", async () => {
    const result = await runCLI(["search", "--limit=1.5"]);
    expectValidationError(result, "limit");
    expect(JSON.parse(result.stderr).error.message).toContain("Expected integer");
  });

  test("search --radius=-10 is rejected", async () => {
    const result = await runCLI(["search", "--radius=-10"]);
    expectValidationError(result, "radius");
    expect(JSON.parse(result.stderr).error.message).toContain("greater than or equal to 1");
  });

  test("search --radius=2.5 is rejected as non-integer", async () => {
    const result = await runCLI(["search", "--radius=2.5"]);
    expectValidationError(result, "radius");
    expect(JSON.parse(result.stderr).error.message).toContain("Expected integer");
  });

  test("occupations --per-page=-1 is rejected", async () => {
    const result = await runCLI(["occupations", "--per-page=-1"]);
    expectValidationError(result, "per-page");
  });

  test("suggestions --limit=-1 is rejected", async () => {
    const result = await runCLI(["suggestions", "--limit=-1"]);
    expectValidationError(result, "limit");
  });

  test("valid numeric flags pass schema validation (proven offline via the required-flag guard)", async () => {
    const result = await runCLI(["occupations", "--per-page=5"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "--search-string is required",
      code: "MISSING_REQUIRED",
    });
  });
});
