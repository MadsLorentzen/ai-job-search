import { afterEach, describe, expect, test } from "bun:test";
import { apiFetch, apiPost } from "../src/helpers";

// The portal contract requires backoff on 429/5xx. These tests pin the retry
// loop offline: a stubbed fetch counts attempts, and a stubbed setTimeout
// fires immediately so the exhaustion case does not sleep through the real
// 500ms -> 5s backoff schedule. apiFetch and apiPost carry separate copies of
// the loop, so both are exercised to keep them from drifting apart.

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

const wrappers: Array<[string, () => Promise<{ ok: boolean }>]> = [
  ["apiFetch", () => apiFetch<{ ok: boolean }>("/x")],
  ["apiPost", () => apiPost<{ ok: boolean }>("/x", {})],
];

for (const [name, call] of wrappers) {
  describe(`${name} retry/backoff`, () => {
    test("retries a 429 and succeeds on the next attempt", async () => {
      instantTimers();
      const state = stubFetch([
        () => new Response("", { status: 429 }),
        () => new Response('{"ok":true}', { status: 200 }),
      ]);

      const data = await call();
      expect(data.ok).toBe(true);
      expect(state.calls).toBe(2);
    });

    test("does not retry a plain 4xx", async () => {
      const state = stubFetch([() => new Response("", { status: 400 })]);

      await expect(call()).rejects.toThrow(/400/);
      expect(state.calls).toBe(1);
    });

    test("gives up after the initial attempt plus six retries on persistent 5xx", async () => {
      instantTimers();
      const state = stubFetch([() => new Response("", { status: 500 })]);

      await expect(call()).rejects.toThrow(/500/);
      expect(state.calls).toBe(7);
    });
  });
}
