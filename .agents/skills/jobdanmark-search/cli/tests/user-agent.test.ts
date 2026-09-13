import { afterEach, describe, expect, test } from "bun:test";
import { apiFetch, apiPost, htmlFetch, USER_AGENT } from "../src/helpers";

// Bun's fetch injects an anonymous default User-Agent (Bun/1.3.10) when code
// sets none. This CLI should say who is asking, in the honest style jobindex
// already uses on htmlFetch ("Mozilla/5.0 (compatible; jobindex-cli/1.0)").
// Assert the header is present on every request. Fails on the pre-change code.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function headerValue(headers: RequestInit["headers"], name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([k]) => k === name);
    return found ? String(found[1]) : null;
  }
  const value = headers?.[name];
  return typeof value === "string" ? value : null;
}

describe("apiFetch user agent", () => {
  test("sends a User-Agent header", async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await apiFetch("/api/search/autocomplete", { q: "it" });
    expect(headerValue(init?.headers, "User-Agent")).toBe(USER_AGENT);
  });
});

describe("apiPost user agent", () => {
  test("sends a User-Agent header alongside Content-Type", async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await apiPost("/api/jobsearch/search/1", { q: "it" });
    expect(headerValue(init?.headers, "User-Agent")).toBe(USER_AGENT);
    expect(headerValue(init?.headers, "Content-Type")).toBe("application/json");
  });
});

describe("htmlFetch user agent", () => {
  test("sends the shared User-Agent and asks for HTML", async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response("<html></html>", { status: 200 });
    }) as unknown as typeof fetch;

    await htmlFetch("https://jobdanmark.dk/job/x");
    expect(headerValue(init?.headers, "User-Agent")).toBe(USER_AGENT);
    expect(headerValue(init?.headers, "Accept")).toContain("text/html");
  });
});
