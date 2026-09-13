import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

describe("Jobindex CLI error contract", () => {
  test("search without a query fails with JSON on stderr", async () => {
    const result = await runCLI(["search"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "--query is required",
      code: "MISSING_REQUIRED",
    });
  });

  test("detail without an ID fails before making a request", async () => {
    const result = await runCLI(["detail"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "Job ID or URL is required",
      code: "MISSING_REQUIRED",
    });
  });

  test("an invalid numeric option fails before making a request", async () => {
    const result = await runCLI(["search", "--query", "test", "--page", "not-a-number"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(error.ok).toBe(false);
    expect(error.error.kind).toBe("validation");
    expect(error.error.option).toBe("page");
    expect(error.error.message).toContain("Expected number");
  });
});
