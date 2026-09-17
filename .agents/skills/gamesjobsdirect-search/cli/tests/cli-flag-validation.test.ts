import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

describe("GamesJobsDirect CLI flag validation", () => {
  test("--limit abc is rejected as non-numeric", async () => {
    const result = await runCLI(["search", "-q", "test", "--limit", "abc"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("BAD_ARG");
  });

  test("--jobage abc is rejected as non-numeric", async () => {
    const result = await runCLI(["search", "-q", "test", "--jobage", "abc"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("BAD_ARG");
  });

  test("detail with no id is rejected", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("NO_ID");
  });

  test("detail with a non-numeric id is rejected", async () => {
    const result = await runCLI(["detail", "not-an-id"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("BAD_ID");
  });

  test("unknown command is rejected", async () => {
    const result = await runCLI(["bogus"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("BAD_CMD");
  });

  test("no command prints help and exits 1", async () => {
    const result = await runCLI([]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("gamesjobsdirect-cli");
  });
});
