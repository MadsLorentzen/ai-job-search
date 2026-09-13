import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

describe("Jobnet CLI error contract", () => {
  test("detail without an ID fails with JSON on stderr", async () => {
    const result = await runCLI(["detail"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "Job ad ID is required",
      code: "MISSING_REQUIRED",
    });
  });

  test("occupations without a search string fails before making a request", async () => {
    const result = await runCLI(["occupations"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "--search-string is required",
      code: "MISSING_REQUIRED",
    });
  });

  test("suggestions without a query fails before making a request", async () => {
    const result = await runCLI(["suggestions"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "--query is required",
      code: "MISSING_REQUIRED",
    });
  });

  test("an invalid numeric option fails before making a request", async () => {
    const result = await runCLI(["search", "--page", "not-a-number"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(error.ok).toBe(false);
    expect(error.error.kind).toBe("validation");
    expect(error.error.option).toBe("page");
    expect(error.error.message).toContain("Expected number");
  });
});
