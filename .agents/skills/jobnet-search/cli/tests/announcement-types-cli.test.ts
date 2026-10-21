import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import response from "./fixtures/announcement-types.json";

// Projected from the public /bff/FindJob/Search response on 2026-10-20:
// searchString=software&jobAnnouncementType=Hotjob. Keep the producer's
// announcement facets and one matching ad; tests never contact Jobnet.
const cli = join(import.meta.dir, "../src/cli.ts");

test("search help lists every announcement type offered by Jobnet", async () => {
  const proc = Bun.spawn([process.execPath, "run", cli, "search", "--help"], {
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  for (const facet of response.searchFacets.jobAnnouncements) {
    expect(stdout).toContain(facet.type);
  }
});

test("search --job-type Hotjob reaches the API filter and returns the captured ad", async () => {
  const requests: URL[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      requests.push(new URL(request.url));
      return Response.json(response);
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "jobnet-announcements-"));
  const preload = join(dir, "fetch.ts");
  writeFileSync(preload, `
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.protocol === "data:") return originalFetch(input, init);
      if (url.origin !== "https://jobnet.dk" || url.pathname !== "/bff/FindJob/Search") {
        throw new Error("Unexpected announcement fixture request");
      }
      return originalFetch(${JSON.stringify(server.url.origin)} + url.pathname + url.search, init);
    };
  `);
  try {
    const proc = Bun.spawn([
      process.execPath, "run", "--preload", preload, cli, "search",
      "--search-string", "software", "--job-type", "Hotjob",
    ], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get("jobAnnouncementType")).toBe("Hotjob");
    expect(requests[0].searchParams.get("searchString")).toBe("software");
    expect(response.jobAds[0].jobAnnouncementTypeName).toBe("Hotjob");
    expect(JSON.parse(stdout).results[0].jobAdId).toBe(response.jobAds[0].jobAdId);
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
