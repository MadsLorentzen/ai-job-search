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

  test("keeps native fields unchanged (additive contract)", () => {
    const result = normalizeItem(item());

    expect(result.companyName).toBe("Statens It");
    expect(result.publishedDate).toBe("27-07-2026");
    expect(result.applicationDeadline).toBe("17-08-2026");
  });
});