import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function search(args: string[]): Promise<URL[]> {
  const requests: URL[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url);
      // Empty protocol fixtures isolate option serialization, not HTML parsing.
      return new Response(url.pathname === "/job/rss"
        ? '<rss version="2.0"><channel></channel></rss>'
        : '<title>0 relevante job</title>');
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "jobbank-repeatable-"));
  const preload = join(dir, "fetch.ts");
  writeFileSync(preload, `
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      // Bunli's bundled layout engine may load its local WASM as a data URL.
      if (url.protocol === "data:") return originalFetch(input, init);
      if (url.origin !== "https://jobbank.dk" || !["/job/rss", "/job/"].includes(url.pathname)) {
        throw new Error("Unexpected fixture request");
      }
      return originalFetch(${JSON.stringify(server.url.origin)} + url.pathname + url.search, init);
    };
  `);
  try {
    const proc = Bun.spawn([
      process.execPath, "run", "--preload", preload,
      join(import.meta.dir, "../src/cli.ts"), "search", ...args,
    ], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ meta: { total: 0 }, results: [] });
    expect(requests.map((url) => url.pathname)).toEqual(["/job/rss", "/job/"]);
    return requests;
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
}

// SKILL.md documents repeated values as OR filters, including the concrete
// industry/location example. Assert the actual CLI's RSS and count requests;
// rssFetch({ key: [a, b] }) alone bypasses the argument parser that lost a.
const filters = [
  ["industry", "branche", "10331", "10358"],
  ["location", "amt", "2", "8"],
  ["type", "cvtype", "3", "6"],
  ["education", "udd", "24", "21"],
  ["work-area", "erf", "31", "43"],
  ["suitable-for", "andet", "2", "4"],
];

for (const [flag, parameter, first, second] of filters) {
  test(`search preserves repeated --${flag} values in both portal requests`, async () => {
    for (const url of await search([`--${flag}`, first, `--${flag}`, second])) {
      expect(url.searchParams.getAll(parameter)).toEqual([first, second]);
    }
  });
}

test("mixed equals-form and comma-separated repeated values are retained", async () => {
  for (const url of await search(["--type=3,6", "--type=13"])) {
    expect(url.searchParams.getAll("cvtype")).toEqual(["3", "6", "13"]);
  }
});

test("a single value and a comma list keep their existing request shape", async () => {
  for (const url of await search(["--industry", "10331", "--location=2,8"])) {
    expect(url.searchParams.getAll("branche")).toEqual(["10331"]);
    expect(url.searchParams.getAll("amt")).toEqual(["2", "8"]);
  }
});
