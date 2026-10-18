import { afterEach, describe, expect, test } from "bun:test";
import { apiGet, retryAfterMs } from "../src/helpers";

// The portal contract requires backoff on 429/5xx. These tests pin the retry
// loop offline: a stubbed fetch counts attempts, and a stubbed setTimeout
// fires immediately so the exhaustion case does not sleep through the real
// 500ms -> 8s backoff schedule. apiGet's documented graceful-degradation
// contract (connection failures fail fast, no retry) is pinned too.

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

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

describe("apiGet retry/backoff", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    instantTimers();
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => new Response('{"data":[]}', { status: 200 }),
    ]);

    const envelope = await apiGet<unknown[]>("/x");
    expect(envelope).not.toBeNull();
    expect(state.calls).toBe(2);
  });

  test("returns the documented null on 404 without retrying", async () => {
    const state = stubFetch([() => new Response("", { status: 404 })]);

    const envelope = await apiGet("/x");
    expect(envelope).toBeNull();
    expect(state.calls).toBe(1);
  });

  test("gives up after the initial attempt plus six retries on persistent 5xx", async () => {
    instantTimers();
    const state = stubFetch([() => new Response("", { status: 500 })]);

    await expect(apiGet("/x")).rejects.toThrow(/500/);
    expect(state.calls).toBe(7);
  });

  test("fails fast on a connection error - no retry, per the graceful-degradation contract", async () => {
    const state = { calls: 0 };
    globalThis.fetch = (async () => {
      state.calls++;
      throw new TypeError("Unable to connect");
    }) as unknown as typeof fetch;

    await expect(apiGet("/x")).rejects.toThrow(/could not reach the freehire API/);
    expect(state.calls).toBe(1);
  });
});

describe("Retry-After", () => {
  test("waits at least as long as the server asks before retrying a 429", async () => {
    const waits: number[] = [];
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      waits.push(ms ?? 0);
      return originalSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout;
    const state = stubFetch([
      () => new Response("", { status: 429, headers: { "Retry-After": "40" } }),
      () => new Response('{"data":[]}', { status: 200 }),
    ]);

    await apiGet<unknown[]>("/x");
    expect(state.calls).toBe(2);
    expect(waits).toEqual([40_000]);
  });

  test("keeps its own backoff when the header asks for less", async () => {
    const waits: number[] = [];
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      waits.push(ms ?? 0);
      return originalSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout;
    stubFetch([
      () => new Response("", { status: 429, headers: { "Retry-After": "0" } }),
      () => new Response('{"data":[]}', { status: 200 }),
    ]);

    await apiGet<unknown[]>("/x");
    expect(waits[0]).toBeGreaterThanOrEqual(500);
  });

  test("parses delta-seconds and HTTP-dates, caps long waits, ignores junk", () => {
    const now = Date.parse("2026-10-18T12:00:00Z");
    expect(retryAfterMs("2", now)).toBe(2_000);
    expect(retryAfterMs("Sun, 18 Oct 2026 12:00:30 GMT", now)).toBe(30_000);
    expect(retryAfterMs("Sun, 18 Oct 2026 11:59:00 GMT", now)).toBe(0);
    expect(retryAfterMs("3600", now)).toBe(60_000);
    expect(retryAfterMs(null, now)).toBeNull();
    expect(retryAfterMs("soon", now)).toBeNull();
  });
});
