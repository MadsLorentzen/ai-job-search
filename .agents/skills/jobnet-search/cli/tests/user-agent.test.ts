import { afterEach, describe, expect, test } from "bun:test";
import { apiFetch, USER_AGENT } from "../src/helpers";

// Every other Danish-portal CLI sends a browser-like User-Agent on purpose
// (jobbank exports USER_AGENT and its tests assert it; jobindex sets it on
// htmlFetch). Requests without one are rejected by the portals' bot filters.
// Assert the header is present on every request. Fails on the pre-fix code.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("apiFetch user agent", () => {
  test("sends a User-Agent header", async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await apiFetch("/search");
    const headers = init?.headers as Record<string, string> | Headers | undefined;
    const value =
      headers instanceof Headers ? headers.get("User-Agent") : headers?.["User-Agent"];
    expect(value).toBe(USER_AGENT);
  });
});
