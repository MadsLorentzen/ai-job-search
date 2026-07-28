import { describe, expect, test } from "bun:test";
import {
  jobageToTbs,
  normalizeDate,
  normalizeDomain,
  toDetail,
  toResult,
  type SearchItem,
} from "../src/helpers";
import { normalizeUrl } from "../src/commands/detail";

// Firecrawl returns two different item shapes from /v2/search: plain results
// (top-level url/title) without scrapeOptions, and Documents (fields under
// `metadata`) with it. Both must map onto the portal-skill contract.
describe("toResult", () => {
  test("maps a plain (unenriched) search result", () => {
    const item: SearchItem = {
      url: "https://job-boards.greenhouse.io/acme/jobs/1",
      title: "Data Engineer at Acme",
      description: "Build pipelines",
      position: 1,
    };
    expect(toResult(item)).toEqual({
      id: "https://job-boards.greenhouse.io/acme/jobs/1",
      title: "Data Engineer at Acme",
      company: null,
      location: null,
      date: null,
      url: "https://job-boards.greenhouse.io/acme/jobs/1",
      snippet: "Build pipelines",
    });
  });

  test("maps an enriched Document, taking the extracted job fields", () => {
    const item: SearchItem = {
      url: "https://job-boards.greenhouse.io/acme/jobs/2",
      title: "Job Application for Data Engineer at Acme",
      json: { company: "Acme", location: "Berlin, Germany", date_posted: "2026-07-06" },
      metadata: { sourceURL: "https://job-boards.greenhouse.io/acme/jobs/2", title: "ignored" },
    };
    const result = toResult(item);
    expect(result?.company).toBe("Acme");
    expect(result?.location).toBe("Berlin, Germany");
    expect(result?.date).toBe("2026-07-06");
  });

  test("falls back to metadata.sourceURL when the top-level url is absent", () => {
    const item: SearchItem = {
      metadata: { sourceURL: "https://example.com/jobs/3", title: "Geophysicist" },
    };
    const result = toResult(item);
    expect(result?.url).toBe("https://example.com/jobs/3");
    // The URL doubles as the id, which `detail` consumes.
    expect(result?.id).toBe("https://example.com/jobs/3");
    expect(result?.title).toBe("Geophysicist");
  });

  test("drops an item with no resolvable URL rather than emitting a placeholder", () => {
    expect(toResult({ title: "Orphaned posting" })).toBeNull();
  });

  test("treats empty extracted strings as missing, not as empty values", () => {
    const item: SearchItem = {
      url: "https://example.com/jobs/4",
      title: "Analyst",
      json: { company: "", location: "   ", date_posted: "" },
    };
    const result = toResult(item);
    expect(result?.company).toBeNull();
    expect(result?.location).toBeNull();
    expect(result?.date).toBeNull();
  });
});

describe("toDetail", () => {
  test("carries the markdown body and the extra extracted fields", () => {
    const job = toDetail(
      {
        markdown: "  # Data Engineer\n\nWe are hiring.  ",
        json: {
          company: "Acme",
          location: "Copenhagen",
          date_posted: "2026-07-01T09:00:00Z",
          employment_type: "Full-time",
          deadline: "2026-08-01",
        },
        metadata: { sourceURL: "https://example.com/jobs/5", title: "Data Engineer" },
      },
      "https://example.com/jobs/5",
    );
    expect(job.description).toBe("# Data Engineer\n\nWe are hiring.");
    expect(job.employment_type).toBe("Full-time");
    expect(job.deadline).toBe("2026-08-01");
    expect(job.date).toBe("2026-07-01");
  });

  test("falls back to the requested URL when metadata omits it", () => {
    const job = toDetail({ markdown: "text" }, "https://example.com/jobs/6");
    expect(job.url).toBe("https://example.com/jobs/6");
    expect(job.title).toBe("(untitled)");
    expect(job.company).toBeNull();
  });
});

describe("normalizeDate", () => {
  test("normalises an ISO timestamp to YYYY-MM-DD", () => {
    expect(normalizeDate("2026-07-06T15:00:00Z")).toBe("2026-07-06");
  });

  test("keeps an unparseable value verbatim instead of guessing a date", () => {
    expect(normalizeDate("3 days ago")).toBe("3 days ago");
  });

  test("returns null for empty or absent input", () => {
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
  });
});

// tbs buckets the search engine's own freshness signal - it is not a filter over
// the posting's date_posted. --jobage therefore rounds *up* to the smallest
// covering bucket, which is a hint, not a guarantee about posting age.
describe("jobageToTbs", () => {
  test("maps day counts to the smallest covering bucket", () => {
    expect(jobageToTbs(1)).toBe("qdr:d");
    expect(jobageToTbs(7)).toBe("qdr:w");
    expect(jobageToTbs(8)).toBe("qdr:m");
    expect(jobageToTbs(14)).toBe("qdr:m");
    expect(jobageToTbs(31)).toBe("qdr:m");
    expect(jobageToTbs(90)).toBe("qdr:y");
  });

  test("returns null when no filter applies", () => {
    expect(jobageToTbs(undefined)).toBeNull();
    expect(jobageToTbs(0)).toBeNull();
    expect(jobageToTbs(NaN)).toBeNull();
    expect(jobageToTbs(9999)).toBeNull();
  });
});

describe("normalizeDomain", () => {
  test("reduces user input to the bare hostname Firecrawl expects", () => {
    expect(normalizeDomain("https://www.jobindex.dk/jobsoegning?q=x")).toBe("jobindex.dk");
    expect(normalizeDomain("  LinkedIn.com  ")).toBe("linkedin.com");
    expect(normalizeDomain("job-boards.greenhouse.io/acme")).toBe("job-boards.greenhouse.io");
  });

  test("returns null for empty input", () => {
    expect(normalizeDomain("   ")).toBeNull();
  });
});

describe("normalizeUrl", () => {
  test("adds a scheme when omitted", () => {
    expect(normalizeUrl("example.com/jobs/1")).toBe("https://example.com/jobs/1");
  });

  test("keeps an explicit http(s) URL", () => {
    expect(normalizeUrl("http://example.com/jobs/1")).toBe("http://example.com/jobs/1");
  });

  test("rejects non-http schemes and bare words", () => {
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeUrl("not-a-url")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
  });
});
