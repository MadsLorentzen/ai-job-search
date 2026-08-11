import { afterEach, describe, expect, test } from "bun:test";
import { apiFetch } from "../src/helpers";

// The portal contract requires backoff on 429/5xx. These tests pin the retry
// loop offline: a stubbed fetch counts attempts, and a stubbed setTimeout
// fires immediately so the exhaustion case does not sleep through the real
// 500ms -> 8s backoff schedule.

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

describe("apiFetch retry/backoff", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    instantTimers();
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ]);

    const data = await apiFetch<{ ok: boolean }>("/search");
    expect(data).toEqual({ ok: true });
    expect(state.calls).toBe(2);
  });

  test("returns null on a 404 without retrying", async () => {
    const state = stubFetch([() => new Response("", { status: 404 })]);

    const data = await apiFetch("/ad/does-not-exist");
    expect(data).toBeNull();
    expect(state.calls).toBe(1);
  });

  test("throws immediately on a 400 without retrying", async () => {
    const state = stubFetch([() => new Response("", { status: 400 })]);

    await expect(apiFetch("/search")).rejects.toThrow(/400/);
    expect(state.calls).toBe(1);
  });

  test("gives up after the initial attempt plus six retries on persistent 5xx", async () => {
    instantTimers();
    const state = stubFetch([() => new Response("", { status: 500 })]);

    await expect(apiFetch("/search")).rejects.toThrow(/500/);
    expect(state.calls).toBe(7);
  });
});
