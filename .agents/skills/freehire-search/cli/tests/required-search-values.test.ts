import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

describe("named search flags require their documented values", () => {
  for (const name of ["query", "company", "country", "region", "city", "seniority", "category", "skill", "description-format"]) {
    for (const value of [undefined, "", "   "]) {
      test(`--${name} with ${JSON.stringify(value)} fails before requesting jobs`, async () => {
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
          const args = ["search", `--${name}`, ...(value === undefined ? [] : [value]), "--limit", "1"];
          const result = await runCLI(args, { FREEHIRE_API_URL: server.url.toString() });
          expect(result.exitCode).toBe(1);
          expect(result.stdout).toBe("");
          expect(JSON.parse(result.stderr)).toMatchObject({ code: "BAD_ARG" });
          expect(JSON.parse(result.stderr).error).toContain(`--${name}`);
          expect(requests).toEqual([]);
        } finally {
          server.stop(true);
        }
      });
    }
  }

  test("preserves valid named filters and optional boolean flags", async () => {
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
        "search", "-q", "backend engineer", "--country", "DE, GB", "--region", "eu",
        "--city", "Berlin", "--seniority", "senior", "--category", "backend",
        "--skill", "go,kubernetes", "--company", "acme", "--remote", "--no-description",
        "--description-format", "text",
      ], { FREEHIRE_API_URL: server.url.toString() });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(requests).toHaveLength(1);
      const params = requests[0].searchParams;
      expect(params.get("q")).toBe("backend engineer");
      expect(params.getAll("countries")).toEqual(["DE", "GB"]);
      expect(params.getAll("skills")).toEqual(["go", "kubernetes"]);
      expect(params.get("company_slug")).toBe("acme");
      expect(params.get("work_mode")).toBe("remote");
      expect(requests[0].pathname).toBe("/api/v1/jobs/search");
    } finally {
      server.stop(true);
    }
  });

  test("an unfiltered search remains valid when optional flags are omitted", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ data: [], meta: { total: 0 } }),
    });
    try {
      const result = await runCLI(["search"], { FREEHIRE_API_URL: server.url.toString() });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).results).toEqual([]);
    } finally {
      server.stop(true);
    }
  });
});
