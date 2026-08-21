import { describe, expect, test } from "bun:test";
import { normalizeItem, type ApiSearchItem } from "../src/commands/search";

function item(): ApiSearchItem {
  return {
    title: "Softwareudvikler",
    companyName: "Statens It",
    companyLogo: null,
    companyLogoSvgMarkup: null,
    overlayColor: null,
    companyAddress: "Lautruphøj 2, 2750 Ballerup",
    jobTypes: ["fuldtid"],
    boostJob: false,
    publishedDate: "27-07-2026",
    applicationDeadline: "17-08-2026",
    url: "/job/softwareudvikler-til-statens-it",
    coverImage: null,
    silhouetteLogo: false,
  };
}

describe("Jobdanmark search normalization", () => {
  test("additively emits the /scrape contract fields (company, location, date, deadline)", () => {
    const result = normalizeItem(item());

    expect(result).toMatchObject({
      company: "Statens It",
      location: "Ballerup",
      date: "2026-07-27",
      deadline: "2026-08-17",
      url: "https://jobdanmark.dk/job/softwareudvikler-til-statens-it",
    });
  });

  test("maps a missing address zip and a null deadline to null", () => {
    const result = normalizeItem({
      ...item(),
      companyAddress: "Lautruphøj 2",
      applicationDeadline: null,
    });

    expect(result.location).toBeNull();
    expect(result.deadline).toBeNull();
    expect(result.company).toBe("Statens It");
  });

  test("extracts the city when a comma follows the postcode (live jobdanmark shape)", () => {
    const result = normalizeItem({
      ...item(),
      companyAddress: "2670, Greve",
    });

    expect(result.location).toBe("Greve");
  });

  test("trims trailing whitespace from the extracted city", () => {
    const result = normalizeItem({
      ...item(),
      companyAddress: "7100, Vejle ",
    });

    expect(result.location).toBe("Vejle");
  });

  test("does not mistake a 4-digit street number for the postcode", () => {
    const result = normalizeItem({
      ...item(),
      companyAddress: "Vejlevej 1234, 7100 Vejle",
    });

    expect(result.location).toBe("Vejle");
  });

  test("survives a null companyAddress from the API", () => {
    const result = normalizeItem({
      ...item(),
      companyAddress: null,
    });

    expect(result.location).toBeNull();
    expect(result.company).toBe("Statens It");
  });

  test("keeps native fields unchanged (additive contract)", () => {
    const result = normalizeItem(item());

    expect(result.companyName).toBe("Statens It");
    expect(result.publishedDate).toBe("27-07-2026");
    expect(result.applicationDeadline).toBe("17-08-2026");
  });

  test("omits presentation-only keys the agent can never use", () => {
    // coverImage/companyLogo/companyLogoSvgMarkup/overlayColor/silhouetteLogo
    // were ~40% of a live search payload, fed into agent context on every
    // /scrape query (review finding F3, 2026-08-19). The #340 compatibility
    // duplicates (companyName, publishedDate, applicationDeadline) stay.
    const result = normalizeItem(item());

    expect(result).not.toHaveProperty("coverImage");
    expect(result).not.toHaveProperty("companyLogo");
    expect(result).not.toHaveProperty("companyLogoSvgMarkup");
    expect(result).not.toHaveProperty("overlayColor");
    expect(result).not.toHaveProperty("silhouetteLogo");
  });
});