import { afterEach, describe, expect, test } from "bun:test";
import { rssFetch } from "../src/helpers";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("rssFetch", () => {
  test("reports Cloudflare bot protection clearly", async () => {
    globalThis.fetch = (async () =>
      new Response("<html><title>Just a moment...</title></html>", {
        status: 403,
        statusText: "Forbidden",
      })) as unknown as typeof fetch;

    await expect(rssFetch({ key: "data" })).rejects.toThrow(/Cloudflare bot protection/);
  });
});
