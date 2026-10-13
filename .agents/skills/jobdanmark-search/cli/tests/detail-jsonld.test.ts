import { describe, expect, test } from "bun:test";
import { parseJobPostingFromHtml } from "../src/commands/detail";

function pageWithScripts(...scripts: string[]): string {
  return `<html><head>${scripts
    .map((content) => `<script type="application/ld+json">${content}</script>`)
    .join("")}</head><body></body></html>`;
}

describe("parseJobPostingFromHtml JSON-LD", () => {
  test("normalizes a JobPosting object and scalar employment type", () => {
    const posting = {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Data Engineer",
      datePosted: "2026-07-13",
      validThrough: "2026-08-13",
      employmentType: "FULL_TIME",
      hiringOrganization: { name: "Acme A/S", logo: "https://cdn.example/logo.png" },
      jobLocation: {
        address: {
          streetAddress: "Testvej 1",
          addressLocality: "Odense",
          addressRegion: "Syddanmark",
          postalCode: "5000",
          addressCountry: "DK",
        },
      },
      description: "<p>Build reliable pipelines.</p>",
    };

    const parsed = parseJobPostingFromHtml(
      pageWithScripts(JSON.stringify(posting)),
      "data-engineer",
      "https://jobdanmark.dk/job/data-engineer",
    );

    expect(parsed).toEqual({
      slug: "data-engineer",
      url: "https://jobdanmark.dk/job/data-engineer",
      title: "Data Engineer",
      datePosted: "2026-07-13",
      validThrough: "2026-08-13",
      employmentType: ["FULL_TIME"],
      hiringOrganization: { name: "Acme A/S", logo: "https://cdn.example/logo.png" },
      jobLocation: {
        streetAddress: "Testvej 1",
        addressLocality: "Odense",
        addressRegion: "Syddanmark",
        postalCode: "5000",
        addressCountry: "DK",
      },
      description: "Build reliable pipelines.",
      applyUrl: null,
    });
  });

  test("renders an HTML description to the rendered-branch text shape", () => {
    // add-portal.md Step 4: a detail description is "readable text (entities
    // decoded, tags stripped, paragraph breaks preserved)". The rendered-HTML
    // fallback already emits one line per <p>/<li>; the JSON-LD branch passed
    // the markup through verbatim, so the same command produced two shapes.
    const posting = {
      "@type": "JobPosting",
      title: "Udvikler",
      description:
        "<p>Vi s&oslash;ger en udvikler til R&amp;D.</p><p>Second   para<br>line two</p><ul><li>Python &amp; Go</li><li>SQL</li></ul>",
    };

    const parsed = parseJobPostingFromHtml(
      pageWithScripts(JSON.stringify(posting)),
      "udvikler",
      "https://jobdanmark.dk/job/udvikler",
    );

    expect(parsed.description).toBe("Vi søger en udvikler til R&D.\nSecond para\nline two\nPython & Go\nSQL");
    expect(parsed.description).not.toMatch(/<[^>]+>/);
  });

  test("leaves a plain-text description unchanged and an absent one empty", () => {
    const withText = { "@type": "JobPosting", title: "A", description: "Plain prose, no markup." };
    const without = { "@type": "JobPosting", title: "B" };

    expect(parseJobPostingFromHtml(pageWithScripts(JSON.stringify(withText)), "a", "https://jobdanmark.dk/job/a").description).toBe(
      "Plain prose, no markup.",
    );
    expect(parseJobPostingFromHtml(pageWithScripts(JSON.stringify(without)), "b", "https://jobdanmark.dk/job/b").description).toBe("");
  });

  test("skips malformed scripts and finds a JobPosting in an array", () => {
    const scripts = [
      "{not-json",
      JSON.stringify([
        { "@type": "BreadcrumbList" },
        { "@type": "JobPosting", title: "Analyst", employmentType: ["FULL_TIME", "PART_TIME"] },
      ]),
    ];

    const parsed = parseJobPostingFromHtml(
      pageWithScripts(...scripts),
      "analyst",
      "https://jobdanmark.dk/job/analyst",
    );

    expect(parsed.title).toBe("Analyst");
    expect(parsed.employmentType).toEqual(["FULL_TIME", "PART_TIME"]);
    expect(parsed.validThrough).toBeNull();
    expect(parsed.hiringOrganization).toEqual({ name: "", logo: null });
  });

  test("recognizes rendered not-found and unparseable pages", () => {
    expect(() =>
      parseJobPostingFromHtml(
        "<html><head><title>404 | Jobdanmark</title></head><body></body></html>",
        "missing",
        "https://jobdanmark.dk/job/missing",
      ),
    ).toThrow("NOT_FOUND");

    expect(() =>
      parseJobPostingFromHtml(
        "<html><head><title>Jobdanmark</title></head><body></body></html>",
        "broken",
        "https://jobdanmark.dk/job/broken",
      ),
    ).toThrow("Failed to parse job page HTML");
  });
});
