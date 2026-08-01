import { afterEach, describe, expect, test } from "bun:test";
import { textFetch } from "../src/helpers";

// A stalled upstream connection (accepted socket, no response) would otherwise
// hang the CLI forever - fetch has no default timeout. Assert the request
// wrapper carries an AbortSignal timeout. Fails on the pre-fix code (no signal).
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("textFetch request timeout", () => {
  test("passes an AbortSignal timeout to fetch", async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response("<rss></rss>", { status: 200 });
    }) as unknown as typeof fetch;

    await textFetch("https://weworkremotely.com/remote-jobs.rss");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
