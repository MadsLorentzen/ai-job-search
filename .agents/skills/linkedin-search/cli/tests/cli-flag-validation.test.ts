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
  describe("--jobage validation", () => {
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

    test("fractional value (0.5) exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage", "0.5", "--limit", "1"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/jobage/);
      expect(err.error).toMatch(/integer/);
    });

    test("decimal integer (2.0) exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage", "2.0", "--limit", "1"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/jobage/);
      expect(err.error).toMatch(/integer/);
    });

    test("scientific notation (1e3) exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage", "1e3", "--limit", "1"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/jobage/);
      expect(err.error).toMatch(/integer/);
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

    test("fractional value (0.5) exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage-minutes", "0.5"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/jobage-minutes/);
      expect(err.error).toMatch(/integer/);
    });

    test("negative value exits 1 with UNKNOWN_FLAG (parsed as stray flag)", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage-minutes", "-5"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("UNKNOWN_FLAG");
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

  describe("--page validation", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--page", "abc"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/page/);
    });

    test("fractional value (1.5) exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--page", "1.5"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/page/);
      expect(err.error).toMatch(/integer/);
    });
  });

  describe("--limit validation", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--limit", "xyz"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/limit/);
    });

    test("fractional value (1.5) exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--limit", "1.5"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/limit/);
      expect(err.error).toMatch(/integer/);
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


describe("unknown flag rejection", () => {
  // add-portal.md's contract: "a bogus flag or missing required arg exits 1
  // with a JSON error on stderr". A silently discarded flag is worse than an
  // error: on jobdanmark a wrong flag name returned the entire database
  // (13,862 results) as if it matched the query (review finding F13,
  // 2026-08-19). Rejection happens before dispatch, so these are network-free.
  test("a bogus --flag exits 1 with a JSON error instead of being silently discarded", async () => {
    const result = await runCLI(["search", "-l", "Denmark", "-q", "test", "--bogus-flag", "xyz"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("UNKNOWN_FLAG");
    expect(error.error).toContain("--bogus-flag");
  });
});
