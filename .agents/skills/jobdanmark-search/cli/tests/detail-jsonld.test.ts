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
      description: "<p>Build reliable pipelines.</p>",
      applyUrl: null,
    });
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
