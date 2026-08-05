import { afterEach, describe, expect, test } from "bun:test";
import { apiFetch, USER_AGENT } from "../src/helpers";

// Bun's fetch injects an anonymous default User-Agent (Bun/1.3.10) when code
// sets none. This CLI should say who is asking, in the honest style jobindex
// already uses on htmlFetch ("Mozilla/5.0 (compatible; jobindex-cli/1.0)").
// Assert the header is present on every request. Fails on the pre-change code.
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
