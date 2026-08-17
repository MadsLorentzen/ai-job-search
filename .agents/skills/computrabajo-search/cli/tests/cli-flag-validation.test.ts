import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("Computrabajo CLI flag validation (all failures short-circuit before any fetch)", () => {
  test("missing --query exits 1 with NO_QUERY", async () => {
    const result = await runCLI(["search"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("NO_QUERY");
  });

  test("--page 2 exits 1 with UNSUPPORTED_PAGINATION", async () => {
    const result = await runCLI(["search", "-q", "backend", "--page", "2"]);
    expect(result.exitCode).not.toBe(0);
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("UNSUPPORTED_PAGINATION");
    expect(err.error).toMatch(/robots/);
  });

  test("non-numeric --page exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "-q", "backend", "--page", "abc"]);
    expect(result.exitCode).not.toBe(0);
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("BAD_ARG");
    expect(err.error).toMatch(/page/);
  });

  test("non-numeric --limit exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "-q", "backend", "--limit", "xyz"]);
    expect(result.exitCode).not.toBe(0);
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("BAD_ARG");
    expect(err.error).toMatch(/limit/);
  });

  test("detail without a url exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("NO_ID");
  });

  test("detail with a bare id exits 1 with BAD_ID (slug required)", async () => {
    const result = await runCLI(["detail", "E92595FF9C5126D461373E686DCF3405"]);
    expect(result.exitCode).not.toBe(0);
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("BAD_ID");
    expect(err.error).toMatch(/slug/);
  });

  test("unknown command exits 1 with BAD_CMD", async () => {
    const result = await runCLI(["frobnicate"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("BAD_CMD");
  });
});