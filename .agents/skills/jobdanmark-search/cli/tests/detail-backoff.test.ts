import { afterEach, describe, expect, test } from "bun:test";
import { detail } from "../src/commands/detail";

// The portal contract requires backoff on 429/5xx, and `/scrape` calls
// `detail` once per shortlisted posting - a burst that trips the rate limiter
// is exactly when it matters. The handler used to call fetch() directly with
// no retry loop: on a 429 it wrote API_ERROR and exited after ONE attempt,
// while every other portal's detail command retried. These tests drive the
// real command handler (not the wrapper in isolation) with a stubbed fetch,
// instant timers, and process.exit turned into a throw so the exit path can
// be asserted. On the pre-fix handler the first test sees 1 call and an exit.

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalExit = process.exit;
const originalLog = console.log;
const originalStderrWrite = process.stderr.write;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  process.exit = originalExit;
  console.log = originalLog;
  process.stderr.write = originalStderrWrite;
});

const JSON_LD_PAGE = `<!doctype html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting",
"title":"Data Engineer","datePosted":"2026-09-01","hiringOrganization":{"@type":"Organization","name":"Acme"},
"description":"Build pipelines."}</script></head><body></body></html>`;

function instantTimers() {
  globalThis.setTimeout = ((fn: () => void) =>
    originalSetTimeout(fn, 0)) as unknown as typeof setTimeout;
}

function stubFetch(responses: Array<() => Response>): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    const i = Math.min(state.calls, responses.length - 1);
    state.calls++;
    return responses[i]();
  }) as unknown as typeof fetch;
  return state;
}

function captureOutput(): { stdout: string[]; stderr: string[] } {
  const out = { stdout: [] as string[], stderr: [] as string[] };
  console.log = ((...args: unknown[]) => out.stdout.push(args.join(" "))) as typeof console.log;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    out.stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return out;
}

function firstStderrJson(out: { stderr: string[] }): unknown {
  const firstLine = out.stderr.join("").trim().split("\n")[0];
  return JSON.parse(firstLine);
}

class ExitCalled extends Error {
  constructor(public code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

function throwingExit() {
  process.exit = ((code?: number) => {
    throw new ExitCalled(code);
  }) as unknown as typeof process.exit;
}

async function runDetail(slug: string): Promise<{ exit: number | null }> {
  const handler = (detail as unknown as { handler: (ctx: unknown) => Promise<void> }).handler;
  try {
    await handler({ flags: { format: "json" }, positional: [slug], signal: new AbortController().signal });
    return { exit: null };
  } catch (err) {
    if (err instanceof ExitCalled) return { exit: err.code ?? 0 };
    throw err;
  }
}

describe("detail backoff on the real handler path", () => {
  test("retries a 429 and returns the posting on the next attempt", async () => {
    instantTimers();
    throwingExit();
    const out = captureOutput();
    const state = stubFetch([
      () => new Response("", { status: 429, statusText: "Too Many Requests" }),
      () => new Response(JSON_LD_PAGE, { status: 200 }),
    ]);

    const result = await runDetail("data-engineer-acme");

    expect(result.exit).toBeNull();
    expect(state.calls).toBe(2);
    const parsed = JSON.parse(out.stdout.join("\n")) as { title: string; slug: string };
    expect(parsed.title).toBe("Data Engineer");
    expect(parsed.slug).toBe("data-engineer-acme");
    expect(out.stderr.join("")).toBe("");
  });

  test("gives up after the initial attempt plus six retries and exits 1 with API_ERROR", async () => {
    instantTimers();
    throwingExit();
    const out = captureOutput();
    const state = stubFetch([() => new Response("", { status: 503, statusText: "Service Unavailable" })]);

    const result = await runDetail("data-engineer-acme");

    expect(result.exit).toBe(1);
    expect(state.calls).toBe(7);
    const err = firstStderrJson(out) as { code: string; error: string };
    expect(err.code).toBe("API_ERROR");
    expect(err.error).toMatch(/503/);
  });

  test("a 404 is not retried and still reports NOT_FOUND", async () => {
    throwingExit();
    const out = captureOutput();
    const state = stubFetch([() => new Response("", { status: 404 })]);

    const result = await runDetail("gone");

    expect(result.exit).toBe(1);
    expect(state.calls).toBe(1);
    // The handler's own catch block sees the throwing process.exit stub and
    // writes a second line - a test artifact, not CLI behaviour. The first
    // stderr line is the contract.
    expect(firstStderrJson(out)).toEqual({ error: "Job not found", code: "NOT_FOUND" });
  });
});
