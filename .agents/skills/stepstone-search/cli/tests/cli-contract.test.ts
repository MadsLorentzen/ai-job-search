import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

describe("Stepstone CLI error contract", () => {
  test("search without a query fails with JSON on stderr", async () => {
    const result = await runCLI(["search"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "--query/-q is required",
      code: "NO_QUERY",
    });
  });

  test("detail without an ID fails before making a request", async () => {
    const result = await runCLI(["detail"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "detail requires an <id|url>",
      code: "NO_ID",
    });
  });

  test("detail with an unparseable ID fails before making a request", async () => {
    const result = await runCLI(["detail", "not-a-valid-id"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("BAD_ID");
  });

  test("an invalid numeric option fails before making a request", async () => {
    const result = await runCLI(["search", "--query", "test", "--jobage", "not-a-number"]);
    const error = JSON.parse(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(error.code).toBe("BAD_ARG");
  });

  test("--page 2 is rejected — robots.txt disallows &page= on /jobs/ paths", async () => {
    const result = await runCLI(["search", "--query", "test", "--page", "2"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).code).toBe("PAGINATION_UNSUPPORTED");
  });

  test("unknown command fails with JSON on stderr", async () => {
    const result = await runCLI(["bogus"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: 'Unknown command "bogus"',
      code: "BAD_CMD",
    });
  });
});
