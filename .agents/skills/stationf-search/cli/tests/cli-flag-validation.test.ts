import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

// These assert on validation that happens BEFORE any network call, so the suite
// runs offline. The "valid flag" cases only check the ABSENCE of a validation
// error, never the search result itself.

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("stationf CLI flag validation", () => {
  describe("numeric flags", () => {
    for (const name of ["jobage", "page", "limit"]) {
      test(`--${name} non-numeric exits 1 with BAD_ARG`, async () => {
        const result = await runCLI(["search", `--${name}`, "foo"]);
        expect(result.exitCode).not.toBe(0);
        const err = parsedStderr(result.stderr);
        expect(err.code).toBe("BAD_ARG");
        expect(err.error).toMatch(new RegExp(name));
      });
    }
  });

  describe("--contract", () => {
    test("an unknown contract type exits 1 with BAD_ARG and lists the accepted values", async () => {
      const result = await runCLI(["search", "--contract", "cdi-permanent"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/alternance/);
    });

    test("one bad value in a comma list fails the whole flag", async () => {
      const result = await runCLI(["search", "--contract", "cdi,nope"]);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });
  });

  describe("--remote", () => {
    test("an unknown mode exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--remote", "sometimes"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });
  });

  describe("--sort", () => {
    test("an unknown sort mode exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--sort", "salary"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });
  });

  describe("--facet", () => {
    test("a facet without '=' exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--facet", "novalue"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });
  });

  describe("detail arguments", () => {
    test("a missing id exits 1 with NO_ID", async () => {
      const result = await runCLI(["detail"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("NO_ID");
    });

    test("an unparseable id exits 1 with BAD_ID (no network)", async () => {
      const result = await runCLI(["detail", "not an id!"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ID");
    });
  });

  describe("command dispatch", () => {
    test("an unknown command exits 1 with BAD_CMD on stderr, nothing on stdout", async () => {
      const result = await runCLI(["frobnicate"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_CMD");
      expect(result.stdout).toBe("");
    });

    test("no command prints help and exits 1", async () => {
      const result = await runCLI([]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toMatch(/USAGE/);
    });

    test("--help exits 0", async () => {
      const result = await runCLI(["search", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/stationf-cli/);
    });
  });
});
