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
      requests.push(new URL(request.url));
      // The test checks the documented invocation and request route, not live
      // portal markup. This is the existing Stash shape with no result items.
      return new Response('<script>var Stash = {"jobsearch":{"result_app":{"storeData":{"searchResponse":{"hitcount":0,"results":[]}}}}};</script>');
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "jobindex-doc-search-"));
  const preload = join(dir, "fetch.ts");
  writeFileSync(preload, `
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.protocol === "data:") return originalFetch(input, init);
      if (url.origin !== "https://www.jobindex.dk" || url.pathname !== "/jobsoegning") {
        throw new Error("Unexpected documented search endpoint");
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
    expect(stdout).not.toBe("");
    expect(requests).toHaveLength(1);
    return requests;
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
}

test.each(["LF", "CRLF"])("the skill's posted-today example runs through the real search CLI with %s newlines", async (lineEnding) => {
  const source = await Bun.file(join(import.meta.dir, "../../SKILL.md")).text();
  const checkout = source.replace(/\r\n/g, "\n").replace(/\n/g, lineEnding === "CRLF" ? "\r\n" : "\n");
  expect(checkout.includes("\r\n")).toBe(lineEnding === "CRLF");
  const skill = checkout.replace(/\r\n/g, "\n");
  const example = skill.match(/### Jobs posted today[^\n]*\n\n```bash\n([\s\S]*?)```/)?.[1];
  expect(example).toBeDefined();
  // These concrete documentation examples contain only ordinary quoted or
  // unquoted shell words. No shell is invoked and no profile data is loaded.
  const words = Array.from(example!.replace(/\\\n/g, " ").matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g),
    (match) => match[1] ?? match[2] ?? match[3]);
  const args = words.slice(words.indexOf("search") + 1);
  const [url] = await search(args);
  expect(url.searchParams.get("q")).toBeTruthy();
  expect(url.searchParams.get("jobage")).toBe("1");
});

test("a required query and page reach the current HTML endpoint", async () => {
  const [url] = await search(["--query", "python", "--page", "2"]);
  expect(url.pathname).toBe("/jobsoegning");
  expect(url.searchParams.get("q")).toBe("python");
  expect(url.searchParams.get("page")).toBe("2");
});
