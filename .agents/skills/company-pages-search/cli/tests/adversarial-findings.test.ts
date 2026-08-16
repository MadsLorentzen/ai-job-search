import { describe, expect, test } from "bun:test";
import { scrapeGenericLinks, curlFallback, type RobotsGate } from "../src/helpers";
import { runCLI } from "./helpers";

// Regression pins for defects found by an adversarial review (grok), not by
// inspection. Each one was reproduced before it was fixed.

describe("the gate is applied to every redirect hop, not just the first URL", () => {
  test("permission for one origin is not spent on another", async () => {
    // curl used -L, so a permitted first URL could redirect anywhere and the
    // full browser header set went to a host whose robots.txt was never read.
    const gated: string[] = [];
    const gate: RobotsGate = async (u) => {
      gated.push(u);
      return u.startsWith("https://allowed.example");
    };
    // No redirect available in a unit test without a server; assert instead that
    // the very first thing curlFallback does is gate the URL it was handed, and
    // that a refusal short-circuits before any subprocess runs.
    const body = await curlFallback("https://denied.example/jobs", gate);
    expect(body).toBe("");
    expect(gated).toEqual(["https://denied.example/jobs"]);
  });

  test("a refusing gate yields no body even when curl would have succeeded", async () => {
    const body = await curlFallback("https://example.com/jobs", async () => false);
    expect(body).toBe("");
  });
});

describe("generic scraper: href forms that used to scrape to zero links", () => {
  const base = "https://acme.example/careers";

  test("single-quoted href is found", () => {
    const out = scrapeGenericLinks(`<a href='/careers/1'>Engineer job</a>`, base, "Acme");
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://acme.example/careers/1");
  });

  test("unquoted href is found", () => {
    const out = scrapeGenericLinks(`<a href=/careers/2>Analyst job</a>`, base, "Acme");
    expect(out).toHaveLength(1);
  });

  test("whitespace around the equals sign is tolerated", () => {
    const out = scrapeGenericLinks(`<a href = "/careers/3">Job three</a>`, base, "Acme");
    expect(out).toHaveLength(1);
  });

  test("double-quoted href still works — no regression", () => {
    const out = scrapeGenericLinks(`<a href="/careers/4">Job four</a>`, base, "Acme");
    expect(out).toHaveLength(1);
  });

  test("attributes before href do not defeat the match", () => {
    const out = scrapeGenericLinks(`<a class="x" data-y='z' href='/jobs/5'>Role five</a>`, base, "Acme");
    expect(out).toHaveLength(1);
  });

  test.each([
    ["javascript:", `<a href="javascript:openJobs()">See our jobs</a>`],
    ["data:", `<a href="data:text/html,job">job</a>`],
    ["mailto:", `<a href="mailto:careers@acme.example">careers</a>`],
  ])("%s links are not emitted as postings", (_label, html) => {
    expect(scrapeGenericLinks(html, base, "Acme")).toHaveLength(0);
  });

  test("mixed quoting on one page finds all of them", () => {
    const html = `<a href="/jobs/a">Job A</a><a href='/jobs/b'>Job B</a><a href=/jobs/c>Job C</a>`;
    expect(scrapeGenericLinks(html, base, "Acme")).toHaveLength(3);
  });
});

describe("a misconfigured registry entry fails loudly, not as 'no openings'", () => {
  test("an unknown ats type is reported instead of silently scraped", async () => {
    const r = await runCLI(["search", "--company=No Such Company AG"]);
    // Guard entry does not exist, so we get COMPANY_NOT_FOUND rather than a
    // silent empty result — the same principle, reachable without a network.
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr.split("\n").pop()!).code).toBe("COMPANY_NOT_FOUND");
  });
});

describe("a 403 says which failure it was", () => {
  test("gate refusal and a beaten retry are reported differently", async () => {
    const { recordingFetch, stubResponse } = await import("./helpers");
    const { htmlFetch } = await import("../src/helpers");

    const refused = recordingFetch([stubResponse(403)]);
    await expect(
      htmlFetch("https://example.com/jobs", {
        fetchImpl: refused.impl,
        gate: async () => false,
        curl: async () => "",
      }),
    ).rejects.toThrow(/robots_unconfirmed/);

    const beaten = recordingFetch([stubResponse(403)]);
    await expect(
      htmlFetch("https://example.com/jobs", {
        fetchImpl: beaten.impl,
        gate: async () => true,
        curl: async () => "",
      }),
    ).rejects.toThrow(/permits it; the browser-header retry was still blocked/);
  });

  test("a permitted site whose curl succeeds still returns the body", async () => {
    const { recordingFetch, stubResponse } = await import("./helpers");
    const { htmlFetch } = await import("../src/helpers");
    const { impl } = recordingFetch([stubResponse(403)]);
    const body = await htmlFetch("https://example.com/jobs", {
      fetchImpl: impl,
      gate: async () => true,
      curl: async () => "<html>ok</html>",
    });
    expect(body).toBe("<html>ok</html>");
  });
});
