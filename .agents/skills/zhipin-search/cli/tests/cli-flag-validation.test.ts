import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

const LOCATION = "上海";

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("zhipin CLI flag validation", () => {
  describe("--location validation", () => {
    test("missing --location exits 1 with NO_LOCATION", async () => {
      const result = await runCLI(["search"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("NO_LOCATION");
    });

    test("unknown city name exits 1 with BAD_LOCATION", async () => {
      const result = await runCLI(["search", "-l", "Atlantis"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_LOCATION");
    });

    test("a raw 9-digit city code passes location validation", async () => {
      const result = await runCLI(["search", "-l", "101020100", "--limit", "1"]);
      const err = parsedStderr(result.stderr);
      expect(err.code).not.toBe("BAD_LOCATION");
      expect(err.code).not.toBe("NO_LOCATION");
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

  describe("valid flags", () => {
    test("known city name + numeric limit produce no BAD_ARG/BAD_LOCATION", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--limit", "5"]);
      const err = parsedStderr(result.stderr);
      expect(err.code).not.toBe("BAD_ARG");
      expect(err.code).not.toBe("BAD_LOCATION");
      expect(err.code).not.toBe("NO_LOCATION");
    });
  });

  describe("detail command validation", () => {
    test("missing id exits 1 with NO_ID", async () => {
      const result = await runCLI(["detail"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("NO_ID");
    });

    test("id with disallowed characters exits 1 with BAD_ID", async () => {
      const result = await runCLI(["detail", "not a valid id!!"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ID");
    });
  });

  describe("help", () => {
    test("search --help prints usage and exits 0", async () => {
      const result = await runCLI(["search", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/zhipin-cli/);
    });

    test("bare --help (no command) prints usage but exits 1, matching linkedin-search's convention", async () => {
      const result = await runCLI(["--help"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toMatch(/zhipin-cli/);
    });

    test("unknown command exits 1 with BAD_CMD", async () => {
      const result = await runCLI(["frobnicate"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_CMD");
    });
  });
});
