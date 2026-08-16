import { describe, test, expect } from "bun:test";
import {
  scrapeGenericLinks,
  matchesFilters,
  applyLocationsFilter,
  classifyFailure,
  type NormalizedJob,
  type RegistryEntry,
} from "../src/helpers";

const page = (body: string) => `<html><body>${body}</body></html>`;

const job = (over: Partial<NormalizedJob> = {}): NormalizedJob => ({
  company: "Acme SA",
  title: "Security Engineer",
  location: "Geneva, Switzerland",
  url: "https://acme.example/jobs/1",
  posted: null,
  source_ats: "generic",
  ...over,
});

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  name: "Acme SA",
  careers_url: "https://acme.example/careers",
  ats: "generic",
  ats_id: "acme",
  ...over,
});

describe("scrapeGenericLinks", () => {
  test("keeps links whose href looks job-related", () => {
    const out = scrapeGenericLinks(
      page(`<a href="/careers/1234">Security Engineer</a>`),
      "https://acme.example/careers",
      "Acme SA",
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Security Engineer");
    expect(out[0].url).toBe("https://acme.example/careers/1234");
    expect(out[0].source_ats).toBe("generic");
  });

  test("keeps links whose text looks job-related even when the href does not", () => {
    const out = scrapeGenericLinks(
      page(`<a href="/x/9">Open position: Analyst</a>`),
      "https://acme.example/careers",
      "Acme SA",
    );
    expect(out).toHaveLength(1);
  });

  test("drops links with no job-ish signal at all", () => {
    const out = scrapeGenericLinks(
      page(`<a href="/about">About us</a><a href="/privacy">Privacy</a>`),
      "https://acme.example/careers",
      "Acme SA",
    );
    expect(out).toHaveLength(0);
  });

  test("drops job-ish links that have no link text", () => {
    const out = scrapeGenericLinks(
      page(`<a href="/careers/1"><img src="x.png"></a>`),
      "https://acme.example/careers",
      "Acme SA",
    );
    expect(out).toHaveLength(0);
  });

  test("absolutizes relative hrefs against the page URL", () => {
    const out = scrapeGenericLinks(
      page(`<a href="jobs/7">Job 7 opening</a>`),
      "https://acme.example/careers/",
      "Acme SA",
    );
    expect(out[0].url).toBe("https://acme.example/careers/jobs/7");
  });

  test("leaves absolute hrefs on other hosts intact", () => {
    const out = scrapeGenericLinks(
      page(`<a href="https://boards.greenhouse.io/acme/jobs/5">Careers listing</a>`),
      "https://acme.example/careers",
      "Acme SA",
    );
    expect(out[0].url).toBe("https://boards.greenhouse.io/acme/jobs/5");
  });

  test("deduplicates repeated URLs — nav and body often link the same posting", () => {
    const out = scrapeGenericLinks(
      page(`<a href="/careers/1">Job A</a><a href="/careers/1">Job A again</a>`),
      "https://acme.example/careers",
      "Acme SA",
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Job A");
  });

  test("decodes HTML entities in link text and href", () => {
    const out = scrapeGenericLinks(
      page(`<a href="/careers?a=1&amp;b=2">Risk &amp; Compliance job</a>`),
      "https://acme.example/",
      "Acme SA",
    );
    expect(out[0].title).toBe("Risk & Compliance job");
    expect(out[0].url).toBe("https://acme.example/careers?a=1&b=2");
  });

  test("strips nested markup out of the title", () => {
    const out = scrapeGenericLinks(
      page(`<a href="/jobs/2"><span>Head of</span> <b>Security</b></a>`),
      "https://acme.example/",
      "Acme SA",
    );
    expect(out[0].title).toBe("Head of Security");
  });

  test("truncates runaway titles rather than emitting a whole page of text", () => {
    const long = "Job " + "x".repeat(400);
    const out = scrapeGenericLinks(
      page(`<a href="/jobs/3">${long}</a>`),
      "https://acme.example/",
      "Acme SA",
    );
    expect(out[0].title.length).toBe(141);
    expect(out[0].title.endsWith("…")).toBe(true);
  });

  test("returns nothing for a JS-shell page — the documented fallback trigger", () => {
    const out = scrapeGenericLinks(
      page(`<div id="root"></div><script src="/app.js"></script>`),
      "https://acme.example/careers",
      "Acme SA",
    );
    expect(out).toEqual([]);
  });
});

describe("matchesFilters", () => {
  test("matches the title case-insensitively", () => {
    expect(matchesFilters(job({ title: "Head of Cyber Security" }), "cyber")).toBe(true);
  });

  test("rejects a non-matching query", () => {
    expect(matchesFilters(job({ title: "Head of Cyber Security" }), "actuary")).toBe(false);
  });

  test("matches location as a substring", () => {
    expect(matchesFilters(job(), undefined, "geneva")).toBe(true);
  });

  test("a job with no location fails an explicit location filter", () => {
    expect(matchesFilters(job({ location: null }), undefined, "geneva")).toBe(false);
  });

  test("no filters means everything passes", () => {
    expect(matchesFilters(job({ location: null }))).toBe(true);
  });
});

describe("applyLocationsFilter", () => {
  test("keeps only jobs matching the registry entry's locations", () => {
    const jobs = [job({ location: "Geneva" }), job({ location: "Singapore" })];
    const out = applyLocationsFilter(jobs, entry({ locations_filter: ["geneva", "lausanne"] }));
    expect(out.map((j) => j.location)).toEqual(["Geneva"]);
  });

  test("is case-insensitive in both directions", () => {
    const out = applyLocationsFilter([job({ location: "GENEVA, CH" })], entry({ locations_filter: ["Geneva"] }));
    expect(out).toHaveLength(1);
  });

  test("keeps unknown-location jobs rather than silently dropping them", () => {
    const out = applyLocationsFilter([job({ location: null })], entry({ locations_filter: ["geneva"] }));
    expect(out).toHaveLength(1);
  });

  test("an absent or empty filter is a no-op", () => {
    const jobs = [job({ location: "Singapore" })];
    expect(applyLocationsFilter(jobs, entry())).toHaveLength(1);
    expect(applyLocationsFilter(jobs, entry({ locations_filter: [] }))).toHaveLength(1);
  });
});

describe("classifyFailure", () => {
  test.each([
    [403, "bot_blocked"],
    [401, "bot_blocked"],
    [404, "url_not_found"],
    [429, "rate_limited"],
    [503, "server_error"],
  ])("HTTP %i classifies as %s", (status, expected) => {
    expect(classifyFailure(status as number)).toBe(expected);
  });

  test("an abort reads as a timeout, not a block", () => {
    expect(classifyFailure(null, new Error("The operation timed out"))).toBe("timeout");
  });

  test("DNS and TLS failures are distinguished from blocking", () => {
    expect(classifyFailure(null, new Error("getaddrinfo ENOTFOUND acme.example"))).toBe("dns_failure");
    expect(classifyFailure(null, new Error("certificate has expired"))).toBe("tls_error");
  });

  test("anything unrecognised stays unknown rather than guessing", () => {
    expect(classifyFailure(null, new Error("something else"))).toBe("unknown");
  });
});
