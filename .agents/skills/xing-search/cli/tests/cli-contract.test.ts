import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

describe("Xing CLI error contract", () => {
  test("search without a query fails with JSON on stderr, before any request", async () => {
    const result = await runCLI(["search"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "the --query/-q flag is required",
      code: "NO_QUERY",
    });
  });

  test("detail without an id fails before any request", async () => {
    const result = await runCLI(["detail"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "detail requires an <id|url>",
      code: "NO_ID",
    });
  });

  test("detail with a bare numeric id is rejected (Xing needs the full slug)", async () => {
    const result = await runCLI(["detail", "122981029"]);

    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("BAD_ID");
    expect(err.error).toContain("full slug");
  });

  test("an unknown flag is rejected, not silently ignored", async () => {
    const result = await runCLI(["search", "--query", "test", "--bogus", "x"]);

    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("UNKNOWN_FLAG");
  });

  test("a non-integer --limit fails before any request", async () => {
    const result = await runCLI(["search", "--query", "test", "--limit", "not-a-number"]);

    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("BAD_ARG");
  });
});
