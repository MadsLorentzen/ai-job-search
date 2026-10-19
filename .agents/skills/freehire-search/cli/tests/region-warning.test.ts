import { describe, expect, test } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// `--region` values are a source-side bucket rather than a geography, so a value can
// be accepted by the API and still match nothing. These run against a loopback
// server that only ever serves the two documented response shapes.

function serve(regions: Record<string, number>, hits: unknown[]) {
  const requested: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requested.push(url.pathname);
      if (url.pathname === "/api/v1/jobs/facets") return Response.json({ data: { facets: { regions } } });
      return Response.json({ data: hits, meta: { total: hits.length } });
    },
  });
  return { server, requested };
}

describe("an empty result set names a region bucket that holds nothing", () => {
  test("warns on stderr when the requested bucket is near-zero, stdout stays clean JSON", async () => {
    const { server, requested } = serve({ eu: 306000, us: 12 }, []);
    try {
      const result = await runCLI(["search", "-q", "typescript", "--region", "us"], {
        FREEHIRE_API_URL: server.url.toString(),
      });
      expect(result.exitCode).toBe(0);
      expect(parseJSON<{ meta: { count: number } }>(result)).toMatchObject({ meta: { count: 0 } });
      expect(result.stderr).toContain("--region us");
      expect(result.stderr).toContain("--country");
      expect(requested).toContain("/api/v1/jobs/facets");
    } finally {
      server.stop(true);
    }
  });

  test("stays silent when the bucket is a real one", async () => {
    const { server } = serve({ eu: 306000 }, []);
    try {
      const result = await runCLI(["search", "-q", "typescript", "--region", "eu"], {
        FREEHIRE_API_URL: server.url.toString(),
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
    } finally {
      server.stop(true);
    }
  });

  test("names only the thin values of a comma-separated request", async () => {
    const { server } = serve({ eu: 306000, amer: 1 }, []);
    try {
      const result = await runCLI(["search", "-q", "typescript", "--region", "eu,amer"], {
        FREEHIRE_API_URL: server.url.toString(),
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("--region amer");
      expect(result.stderr).not.toContain("--region eu,");
    } finally {
      server.stop(true);
    }
  });

  test("a results page is never accompanied by the note", async () => {
    const { server, requested } = serve({ us: 1 }, [{ public_slug: "a", title: "t", company: "c", location: "l", posted_at: null, url: "u" }]);
    try {
      const result = await runCLI(["search", "-q", "typescript", "--region", "us"], {
        FREEHIRE_API_URL: server.url.toString(),
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(requested).not.toContain("/api/v1/jobs/facets");
    } finally {
      server.stop(true);
    }
  });

  test("an unreachable facets endpoint leaves the search answer untouched", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/v1/jobs/facets") return new Response("not found", { status: 404 });
        return Response.json({ data: [], meta: { total: 0 } });
      },
    });
    try {
      const result = await runCLI(["search", "-q", "typescript", "--region", "us"], {
        FREEHIRE_API_URL: server.url.toString(),
      });
      expect(result.exitCode).toBe(0);
      expect(parseJSON<{ meta: { count: number } }>(result)).toMatchObject({ meta: { count: 0 } });
    } finally {
      server.stop(true);
    }
  });
});
