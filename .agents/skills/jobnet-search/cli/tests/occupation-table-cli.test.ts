import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function occupations(format: "json" | "plain" | "table", lineEnding: "LF" | "CRLF") {
  const source = await Bun.file(join(import.meta.dir, "../README.md")).text();
  const checkout = source.replace(/\r\n/g, "\n").replace(/\n/g, lineEnding === "CRLF" ? "\r\n" : "\n");
  expect(checkout.includes("\r\n")).toBe(lineEnding === "CRLF");
  const readme = checkout.replace(/\r\n/g, "\n");
  const section = readme.split("## `occupations`")[1].split("\n---")[0];
  // Use the repository's documented API response unchanged, not a shortened
  // synthetic identifier that would conceal the formatting failure.
  const fixture = JSON.parse(section.match(/```json\n([\s\S]*?)```/)![1]);
  const requests: URL[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url));
      return Response.json(fixture);
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "jobnet-occupation-"));
  const preload = join(dir, "fetch.ts");
  writeFileSync(preload, `
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.protocol === "data:") return originalFetch(input, init);
      if (url.origin !== "https://jobnet.dk" || url.pathname !== "/bff/OccupationSearch") {
        throw new Error("Unexpected occupation fixture request");
      }
      return originalFetch(${JSON.stringify(server.url.origin)} + url.pathname + url.search, init);
    };
  `);
  try {
    const proc = Bun.spawn([
      process.execPath, "run", "--preload", preload,
      join(import.meta.dir, "../src/cli.ts"), "occupations",
      "--search-string", "sygeplejerske", "--per-page", "5", "--format", format,
    ], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get("searchString")).toBe("sygeplejerske");
    expect(requests[0].searchParams.get("pageSize")).toBe("5");
    return { stdout, fixture };
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
}

test.each(["LF", "CRLF"] as const)("occupation table preserves the documented full ESCO URI and UUID with %s newlines", async (lineEnding) => {
  const { stdout, fixture } = await occupations("table", lineEnding);
  const uri = fixture[0].conceptUriDa;
  expect(uri.length).toBeGreaterThan(70);
  expect(stdout.trim().split("\n")[1].split(/\s+/)[0]).toBe(uri);
  expect(stdout).toContain(uri.split("/").at(-1));
});

test.each(["LF", "CRLF"] as const)("occupation JSON retains the same complete identifier with %s newlines", async (lineEnding) => {
  const { stdout, fixture } = await occupations("json", lineEnding);
  expect(JSON.parse(stdout)).toEqual(fixture);
});

test.each(["LF", "CRLF"] as const)("occupation plain output retains the same complete identifier with %s newlines", async (lineEnding) => {
  const { stdout, fixture } = await occupations("plain", lineEnding);
  expect(stdout).toContain(`uri: ${fixture[0].conceptUriDa}`);
  expect(stdout).toContain(`label: ${fixture[0].preferredLabelDa}`);
});
