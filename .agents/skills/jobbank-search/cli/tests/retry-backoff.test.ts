import { afterEach, describe, expect, test } from "bun:test";
import { fetchWithUA } from "../src/helpers";

// The portal contract requires backoff on 429/5xx. These tests pin the retry
// loop offline: a stubbed fetch counts attempts, and a stubbed setTimeout
// fires immediately so the exhaustion case does not sleep through the real
// 500ms -> 5s backoff schedule.
//
// fetchWithUA deliberately RETURNS non-retry statuses instead of throwing -
// callers own 4xx handling (e.g. rssFetch's Cloudflare 403 message). The 4xx
// test pins that contract.

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

describe("fetchWithUA retry/backoff", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    instantTimers();
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => new Response("ok", { status: 200 }),
    ]);

    const response = await fetchWithUA("https://jobbank.dk/x");
    expect(response.status).toBe(200);
    expect(state.calls).toBe(2);
  });

  test("returns a plain 4xx to the caller without retrying", async () => {
    const state = stubFetch([() => new Response("", { status: 403 })]);

    const response = await fetchWithUA("https://jobbank.dk/x");
    expect(response.status).toBe(403);
    expect(state.calls).toBe(1);
  });

  test("gives up after the initial attempt plus six retries on persistent 5xx", async () => {
    instantTimers();
    const state = stubFetch([() => new Response("", { status: 500 })]);

    await expect(fetchWithUA("https://jobbank.dk/x")).rejects.toThrow(/500/);
    expect(state.calls).toBe(7);
  });
});
