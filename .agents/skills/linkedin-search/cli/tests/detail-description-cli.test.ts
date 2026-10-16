import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const endpoint = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4345841651";
const cliPath = join(import.meta.dir, "../src/cli.ts");
const fixture = Bun.file(join(import.meta.dir, "fixtures/detail-orbis-excerpt.html"));

async function detail(format: "json" | "plain") {
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname);
      return new Response(fixture, { headers: { "Content-Type": "text/html" } });
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "linkedin-description-"));
  const preload = join(dir, "fetch.ts");
  // Exercise the documented CLI in a fresh process, preserving its request
  // options. Any request other than this posting fails before network access.
  writeFileSync(preload, `
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== ${JSON.stringify(endpoint)}) throw new Error("Unexpected fixture request");
      return originalFetch(${JSON.stringify(server.url.origin)} + new URL(url).pathname, init);
    };
  `);
  try {
    const proc = Bun.spawn([
      process.execPath, "run", "--preload", preload, cliPath,
      "detail", "4345841651", "--format", format,
    ], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(requests).toEqual(["/jobs-guest/jobs/api/jobPosting/4345841651"]);
    return stdout;
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("detail JSON preserves paragraph and list boundaries from a captured guest response", async () => {
  const job = JSON.parse(await detail("json"));
  expect(job.description).toContain("Europe\n");
  expect(job.description).toContain("Designing and building agentic & multi-agent systems\nDeveloping");
  expect(job.description).not.toContain("<p>");
});

test("detail plain output preserves the same description boundaries", async () => {
  const output = await detail("plain");
  expect(output).toContain("Designing and building agentic & multi-agent systems\nDeveloping");
  expect(output).toContain("Status: CLOSED / EXPIRED");
});

test("description formatting retains the captured posting's other fields and text", async () => {
  const job = JSON.parse(await detail("json"));
  expect(job.id).toBe("4345841651");
  expect(job.title).toBe("Agentic AI Engineer - Full remote - Europe");
  expect(job.seniority).toBe("Mid-Senior level");
  expect(job.employmentType).toBe("Contract");
  expect(job.isActive).toBe(false);
  expect(job.description).toContain("Designing and building agentic & multi-agent systems");
  expect(job.description).toContain("Developing high-performance APIs that power AI agents at scale");
});
