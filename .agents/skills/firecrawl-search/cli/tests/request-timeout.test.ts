import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { apiPost } from "../src/helpers";

// A stalled upstream connection (accepted socket, no response) would otherwise
// hang the CLI forever - fetch has no default timeout. Assert the request wrapper
// carries an AbortSignal timeout and authenticates with a bearer token.
const originalFetch = globalThis.fetch;
const originalKey = process.env.FIRECRAWL_API_KEY;
const originalUrl = process.env.FIRECRAWL_API_URL;

beforeEach(() => {
  process.env.FIRECRAWL_API_KEY = "fc-test-key";
  delete process.env.FIRECRAWL_API_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
  else process.env.FIRECRAWL_API_KEY = originalKey;
  if (originalUrl === undefined) delete process.env.FIRECRAWL_API_URL;
  else process.env.FIRECRAWL_API_URL = originalUrl;
});

/** Capture the headers of a single mocked request that returns an empty success. */
function captureHeaders(): () => Record<string, string> {
  let headers: Record<string, string> = {};
  globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
    headers = (i?.headers ?? {}) as Record<string, string>;
    return new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return () => headers;
}

describe("apiPost request", () => {
  test("passes an AbortSignal timeout and a bearer token to fetch", async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await apiPost("/v2/search", { query: "test" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fc-test-key");
  });

  test("throws a key-specific error on 401 rather than retrying", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await expect(apiPost("/v2/search", { query: "test" })).rejects.toThrow("Unauthorized");
    expect(calls).toBe(1);
  });
});

// Self-hosted Firecrawl runs with authentication disabled by default, so a local
// instance must work with no key at all - and keyless means *no* Authorization
// header, not a placeholder one (which the backend would reject).
describe("self-hosted instances (FIRECRAWL_API_URL)", () => {
  test("sends no Authorization header when self-hosted and keyless", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_URL = "http://localhost:3002";
    const headers = captureHeaders();

    await apiPost("/v2/search", { query: "test" });
    expect(headers().Authorization).toBeUndefined();
  });

  test("still sends an explicitly set key to a self-hosted instance", async () => {
    process.env.FIRECRAWL_API_URL = "http://localhost:3002";
    const headers = captureHeaders();

    await apiPost("/v2/search", { query: "test" });
    expect(headers().Authorization).toBe("Bearer fc-test-key");
  });

  test("still requires a key for the hosted cloud API", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;

    await expect(apiPost("/v2/search", { query: "test" })).rejects.toThrow("FIRECRAWL_API_KEY");
    expect(called).toBe(false);
  });
});
