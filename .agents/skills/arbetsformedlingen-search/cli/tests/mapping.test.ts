import { describe, expect, test } from "bun:test";
import { toJobResult, jobageToPublishedAfter, type RawHit } from "../src/helpers";

function makeHit(overrides: Partial<RawHit> = {}): RawHit {
  return {
    id: "123",
    headline: "Forskningsingenjör",
    webpage_url: "https://arbetsformedlingen.se/platsbanken/annonser/123",
    application_deadline: "2026-08-31T23:59:59",
    publication_date: "2026-08-05T14:52:31",
    employer: { name: "RISE" },
    workplace_address: { municipality: "Mölndal", region: "Västra Götalands län", country: "Sverige" },
    occupation: { label: "Forskningsingenjör, maskin" },
    description: { text: "Full description text" },
    employment_type: { label: "Vanlig anställning" },
    working_hours_type: { label: "Heltid" },
    duration: { label: "Tills vidare" },
    application_details: { url: "https://example.com/apply", email: null, information: null },
    ...overrides,
  };
}

describe("toJobResult", () => {
  test("maps a full hit to the required output shape", () => {
    const result = toJobResult(makeHit());
    expect(result).toEqual({
      id: "123",
      title: "Forskningsingenjör",
      company: "RISE",
      location: "Mölndal, Västra Götalands län",
      date: "2026-08-05T14:52:31",
      url: "https://arbetsformedlingen.se/platsbanken/annonser/123",
      deadline: "2026-08-31T23:59:59",
      occupation: "Forskningsingenjör, maskin",
    });
  });

  test("missing fields become null, never omitted", () => {
    const result = toJobResult(
      makeHit({ employer: null, workplace_address: null, occupation: null, application_deadline: null }),
    );
    expect(result.company).toBeNull();
    expect(result.location).toBeNull();
    expect(result.occupation).toBeNull();
    expect(result.deadline).toBeNull();
    expect(Object.keys(result)).toContain("company");
    expect(Object.keys(result)).toContain("location");
  });

  test("falls back to country when municipality/region are absent", () => {
    const result = toJobResult(
      makeHit({ workplace_address: { municipality: null, region: null, country: "Sverige" } }),
    );
    expect(result.location).toBe("Sverige");
  });
});

describe("jobageToPublishedAfter", () => {
  test("undefined/0/negative/huge -> null (no filter)", () => {
    expect(jobageToPublishedAfter(undefined)).toBeNull();
    expect(jobageToPublishedAfter(0)).toBeNull();
    expect(jobageToPublishedAfter(-1)).toBeNull();
    expect(jobageToPublishedAfter(9999)).toBeNull();
  });

  test("N days returns an ISO date N days before today", () => {
    const expected = new Date();
    expected.setDate(expected.getDate() - 14);
    expect(jobageToPublishedAfter(14)).toBe(expected.toISOString().slice(0, 10));
  });
});
