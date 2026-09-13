import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

// These assert on validation error codes that are emitted BEFORE any network
// call (or independently of it), so the suite is network-free: a valid-flag case
// still runs offline because it only checks the ABSENCE of a validation error.

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("freehire CLI flag validation", () => {
  describe("numeric flag validation", () => {
    for (const name of ["jobage", "page", "limit"]) {
      test(`--${name} non-numeric exits 1 with BAD_ARG`, async () => {
        const result = await runCLI(["search", `--${name}`, "foo"]);
        expect(result.exitCode).not.toBe(0);
        const err = parsedStderr(result.stderr);
        expect(err.code).toBe("BAD_ARG");
        expect(err.error).toMatch(new RegExp(name));
      });
    }

    // Fractional values must be rejected, not truncated: parseInt("0.5") is 0,
    // and jobage 0 fails search.ts's `> 0` guard, so posted_within_days is
    // silently omitted from the outbound request while the CLI exits 0 —
    // the discarded-filter failure the UNKNOWN_FLAG guard exists to prevent (#373).
    for (const name of ["jobage", "page", "limit"]) {
      test(`--${name} fractional exits 1 with BAD_ARG instead of truncating`, async () => {
        const result = await runCLI(["search", `--${name}`, "1.5"]);
        expect(result.exitCode).not.toBe(0);
        const err = parsedStderr(result.stderr);
        expect(err.code).toBe("BAD_ARG");
        expect(err.error).toMatch(new RegExp(name));
      });
    }

    test("--jobage 0.5 (truncates to 0 on master, dropping the freshness filter) exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--jobage", "0.5"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });

    test("--jobage 0 exits 1 with BAD_ARG (0 silently disables the filter, like the Danish CLIs' min(1))", async () => {
      const result = await runCLI(["search", "--jobage", "0"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });

    test("valid integers produce no BAD_ARG", async () => {
      const result = await runCLI(["search", "--jobage", "7", "--page", "1", "--limit", "1"]);
      expect(parsedStderr(result.stderr).code).not.toBe("BAD_ARG");
    });
  });

  describe("--description-format validation", () => {
    test("an unsupported format exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--description-format", "tekst"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/description-format/);
    });
  });

  describe("--facet validation", () => {
    test("a facet without '=' exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--facet", "novalue"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });
  });

  describe("detail argument validation", () => {
    test("missing slug exits 1 with NO_ID", async () => {
      const result = await runCLI(["detail"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("NO_ID");
    });

    test("an unparseable slug exits 1 with BAD_ID (no network)", async () => {
      const result = await runCLI(["detail", "not a slug!"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ID");
    });
  });

  describe("command dispatch", () => {
    test("unknown command exits 1 with BAD_CMD", async () => {
      const result = await runCLI(["frobnicate"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_CMD");
    });

    test("no command prints help and exits 1", async () => {
      const result = await runCLI([]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toMatch(/USAGE/);
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
    const result = await runCLI(["search", "--query", "test", "--bogus-flag", "xyz"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("UNKNOWN_FLAG");
    expect(error.error).toContain("--bogus-flag");
  });
});
