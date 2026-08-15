import { test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers.js";

async function chromeUp(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:9222/json/version", {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const HAS_CHROME = await chromeUp();

test("help prints usage and exits 0", async () => {
  const r = await runCLI(["--help"]);
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("USAGE");
});

test("no command exits 1", async () => {
  const r = await runCLI([]);
  expect(r.exitCode).toBe(1);
});

test("unknown command exits 1 with JSON error on stderr", async () => {
  const r = await runCLI(["bogus"]);
  expect(r.exitCode).toBe(1);
  const e = JSON.parse(r.stderr);
  expect(e.code).toBe("BAD_CMD");
});

test("search with non-numeric --page exits 1", async () => {
  const r = await runCLI(["search", "-q", "x", "--page", "abc"]);
  expect(r.exitCode).toBe(1);
  const e = JSON.parse(r.stderr);
  expect(e.code).toBe("BAD_ARG");
});

test("detail without id exits 1", async () => {
  const r = await runCLI(["detail"]);
  expect(r.exitCode).toBe(1);
  const e = JSON.parse(r.stderr);
  expect(e.code).toBe("NO_ID");
});

// Live test: runs only when Chrome CDP is reachable, so CI stays green.
test("live search returns results via Chrome CDP", async () => {
  if (!HAS_CHROME) {
    console.log("skip: Chrome CDP (127.0.0.1:9222) not running");
    return;
  }
  const r = await runCLI([
    "search",
    "-q",
    "算法工程师",
    "-l",
    "上海",
    "--limit",
    "3",
  ]);
  expect(r.exitCode).toBe(0);
  const parsed = parseJSON<{
    results: Array<{ id: string; title: string; url: string }>;
  }>(r);
  expect(parsed.results.length).toBeGreaterThan(0);
  expect(parsed.results[0].id).toBeTruthy();
  expect(parsed.results[0].title).toBeTruthy();
  expect(parsed.results[0].url).toContain("zhipin.com");
});
