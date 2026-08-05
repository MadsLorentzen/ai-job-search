import { afterEach, describe, expect, test } from "bun:test";
import { apiFetch, apiPost, USER_AGENT } from "../src/helpers";

// Every other Danish-portal CLI sends a browser-like User-Agent on purpose
// (jobbank exports USER_AGENT and its tests assert it; jobindex sets it on
// htmlFetch). Requests without one are rejected by the portals' bot filters.
// Assert the header is present on every request. Fails on the pre-fix code.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function captureInit(): { init: () => RequestInit | undefined } {
  let captured: RequestInit | undefined;
  globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
    captured = i;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { init: () => captured };
}

function headerValue(headers: RequestInit["headers"], name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) return headers.find(([k]) => k === name)?.[1] ?? null;
  return headers?.[name] ?? null;
}

describe("apiFetch user agent", () => {
  test("sends a User-Agent header", async () => {
    const { init } = captureInit();

    await apiFetch("/api/search/autocomplete", { q: "it" });
    expect(headerValue(init().headers, "User-Agent")).toBe(USER_AGENT);
  });
});

describe("apiPost user agent", () => {
  test("sends a User-Agent header alongside Content-Type", async () => {
    const { init } = captureInit();

    await apiPost("/api/jobsearch/search/1", { q: "it" });
    expect(headerValue(init().headers, "User-Agent")).toBe(USER_AGENT);
    expect(headerValue(init().headers, "Content-Type")).toBe("application/json");
  });
});
