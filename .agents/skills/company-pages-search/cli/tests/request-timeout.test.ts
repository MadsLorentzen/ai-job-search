import { afterEach, describe, expect, test } from "bun:test";
import { jsonFetch, htmlFetch } from "../src/helpers";

// A stalled upstream connection (accepted socket, no response) would otherwise
// hang the CLI forever — fetch has no default timeout. Assert both request
// wrappers carry an AbortSignal timeout. These stub the global fetch rather
// than using the injection seam, so they pin the real default path a user gets.

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function captureInit(body: string): () => RequestInit | undefined {
  let init: RequestInit | undefined;
  globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
    init = i;
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return () => init;
}

describe("request timeout", () => {
  test("jsonFetch passes an AbortSignal timeout to fetch", async () => {
    const get = captureInit("{}");
    await jsonFetch("https://api.example/jobs");
    expect(get()?.signal).toBeInstanceOf(AbortSignal);
  });

  test("htmlFetch passes an AbortSignal timeout to fetch", async () => {
    const get = captureInit("<html></html>");
    await htmlFetch("https://acme.example/careers");
    expect(get()?.signal).toBeInstanceOf(AbortSignal);
  });

  test("the signal is not already aborted when the request is made", async () => {
    const get = captureInit("{}");
    await jsonFetch("https://api.example/jobs");
    expect((get()?.signal as AbortSignal).aborted).toBe(false);
  });

  test("redirects are followed rather than returned as opaque responses", async () => {
    const get = captureInit("{}");
    await jsonFetch("https://api.example/jobs");
    expect(get()?.redirect).toBe("follow");
  });

  test("a request that never resolves is abandoned, not awaited forever", async () => {
    // A hung socket surfaces as a rejection from fetch. The wrapper must
    // classify and rethrow it rather than swallow it into an empty result,
    // which would read as "this employer has no openings".
    globalThis.fetch = (async () => {
      throw new Error("The operation timed out.");
    }) as unknown as typeof fetch;
    await expect(htmlFetch("https://acme.example/careers")).rejects.toThrow(/\[timeout\]/);
  });
});
