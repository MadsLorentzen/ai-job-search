import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

describe("stepstone-cli error contract", () => {
  test("no command prints help and fails", async () => {
    const result = await runCLI([]);
    expect(result.exitCode).toBe(1);
  });

  test("detail without an id/url fails with JSON on stderr", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "detail requires a <url|id>",
      code: "NO_ID",
    });
  });

  test("detail with an unparseable id fails before making a request", async () => {
    const result = await runCLI(["detail", "not-a-valid-id"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("BAD_ID");
  });

  test("detail with a bare numeric id (no slug) fails before making a request", async () => {
    const result = await runCLI(["detail", "14255090"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("ID_NEEDS_URL");
  });

  test("an invalid numeric flag fails before making a request", async () => {
    const result = await runCLI(["search", "--query", "test", "--limit", "not-a-number"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("BAD_ARG");
  });

  test("unknown command fails with JSON on stderr", async () => {
    const result = await runCLI(["bogus"]);
    expect(result.exitCode).toBe(1);
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("BAD_CMD");
  });
});
