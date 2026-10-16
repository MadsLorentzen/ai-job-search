import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

// Invalid flags fail before any request. Valid-flag controls run against a
// loopback fixture and assert the requested filters, not just an absent error.

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

    test("valid integers construct the requested search offline", async () => {
      const requests: URL[] = [];
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          requests.push(new URL(request.url));
          return Response.json({ data: [], meta: { total: 0 } });
        },
      });
      try {
        const result = await runCLI(["search", "--jobage", "7", "--page", "1", "--limit", "1"],
          { FREEHIRE_API_URL: server.url.toString() });
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(requests).toHaveLength(1);
        expect(requests[0].pathname).toBe("/api/v1/agent/jobs/search");
        expect(requests[0].searchParams.get("posted_within_days")).toBe("7");
        expect(requests[0].searchParams.get("limit")).toBe("1");
        expect(requests[0].searchParams.get("offset")).toBe("0");
        expect(JSON.parse(result.stdout)).toEqual({ meta: { count: 0, page: 1, total: 0 }, results: [] });
      } finally {
        server.stop(true);
      }
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
    for (const args of [
      ["--facet"],
      ["--facet", "--limit", "1"],
      ["--facet", "salary_min="],
      ["--facet", "salary_min= , "],
      ["--facet", "countries=US", "--facet"],
    ]) {
      test(`${args.join(" ")} rejects an empty filter before requesting jobs`, async () => {
        const requests: string[] = [];
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            requests.push(request.url);
            return Response.json({ data: [], meta: { total: 0 } });
          },
        });
        try {
          const result = await runCLI(["search", ...args], { FREEHIRE_API_URL: server.url.toString() });
          expect(result.exitCode).toBe(1);
          expect(result.stdout).toBe("");
          expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
          expect(parsedStderr(result.stderr).error).toContain("--facet");
          expect(requests).toEqual([]);
        } finally {
          server.stop(true);
        }
      });
    }

    test("repeated facets and comma-separated values reach the API", async () => {
      const requests: URL[] = [];
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          requests.push(new URL(request.url));
          return Response.json({ data: [], meta: { total: 0 } });
        },
      });
      try {
        const result = await runCLI([
          "search", "--facet", "countries=US, CA", "--facet", "countries=GB",
          "--facet", "salary_min=100000", "--remote",
        ], { FREEHIRE_API_URL: server.url.toString() });
        expect(result.exitCode).toBe(0);
        expect(requests).toHaveLength(1);
        expect(requests[0].searchParams.getAll("countries")).toEqual(["US", "CA", "GB"]);
        expect(requests[0].searchParams.get("salary_min")).toBe("100000");
        expect(requests[0].searchParams.get("work_mode")).toBe("remote");
      } finally {
        server.stop(true);
      }
    });

    test("a facet without '=' exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--facet", "novalue"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });
  });

  describe("--format validation", () => {
    test("search with an unsupported format exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--format", "invalid"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/format/);
    });

    test("detail with an unsupported format exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["detail", "example-slug", "--format", "table"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/format/);
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
