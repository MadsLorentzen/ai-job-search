import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

const LOCATION = "Copenhagen, Denmark";

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("LinkedIn CLI flag validation", () => {
  describe("--jobage NaN validation", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage", "foo"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/jobage/);
    });

    test("boolean flag (no value) exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBeTruthy();
    });

    test("valid integer passes validation", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage", "7", "--limit", "1"]);
      const err = parsedStderr(result.stderr);
      expect(err.code).not.toBe("BAD_ARG");
    });

    test("float string truncated to integer, no error", async () => {
      // parseInt("7.5") = 7, which is valid
      const result = await runCLI(["search", "-l", LOCATION, "--jobage", "7.5", "--limit", "1"]);
      const err = parsedStderr(result.stderr);
      expect(err.code).not.toBe("BAD_ARG");
    });

    test("zero is accepted (falsy int should not be treated as missing)", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage", "0", "--limit", "1"]);
      const err = parsedStderr(result.stderr);
      expect(err.code).not.toBe("BAD_ARG");
    });
  });

  describe("--jobage-minutes validation", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage-minutes", "foo"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/jobage-minutes/);
    });

    test("zero exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage-minutes", "0"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/jobage-minutes/);
    });

    test("negative value is parsed as a missing value and exits 1 with BAD_ARG", async () => {
      // parseFlags in cli.ts treats a next-token starting with "-" as absent
      // (`next.startsWith("-")` → flag becomes boolean `true`), and there is no
      // `--flag=value` syntax. So "-5" never reaches --jobage-minutes as a value;
      // parseInt("true") is NaN, and BAD_ARG comes from the NaN branch, not the
      // `v <= 0` guard. Negatives are unreachable through the CLI as currently parsed.
      const result = await runCLI(["search", "-l", LOCATION, "--jobage-minutes", "-5"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/jobage-minutes/);
    });
  });

  describe("--jobage / --jobage-minutes conflict", () => {
    test("both set exits 1 with CONFLICTING_AGE_FLAGS", async () => {
      const result = await runCLI([
        "search", "-l", LOCATION, "--jobage", "7", "--jobage-minutes", "30",
      ]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("CONFLICTING_AGE_FLAGS");
    });
  });

  describe("--page NaN validation", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--page", "abc"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/page/);
    });
  });

  describe("--limit NaN validation", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--limit", "xyz"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/limit/);
    });
  });

  describe("existing validations (regression)", () => {
    test("missing --location exits 1 with NO_LOCATION", async () => {
      const result = await runCLI(["search"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("NO_LOCATION");
    });

    test("all valid flags produce no BAD_ARG", async () => {
      const result = await runCLI([
        "search", "-l", LOCATION, "--jobage", "7", "--page", "1", "--limit", "5",
      ]);
      const err = parsedStderr(result.stderr);
      expect(err.code).not.toBe("BAD_ARG");
    });
  });
});
