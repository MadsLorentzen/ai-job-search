import { describe, expect, test } from "bun:test";
import {
  buildSearchParams,
  createSearchOutput,
  type SearchApiResponse,
  type SearchFlags,
} from "../src/commands/search";

const flags: SearchFlags = {
  "search-string": "data engineer",
  page: 2,
  "per-page": 25,
  order: "BestMatch",
  region: "HovedstadenOgBornholm",
  "work-hours": "FullTime",
  duration: "Permanent",
  "job-type": "Ordinaert",
  "postal-code": "2100",
  radius: 25,
  "occupation-area": "10000",
  "occupation-group": "10060",
  limit: 1,
};

function apiResponse(): SearchApiResponse {
  return {
    totalJobAdCount: 2,
    searchString: "data engineer",
    searchFacets: {
      regions: [{ type: "HovedstadenOgBornholm", jobAdCount: 2 }],
      workHours: [{ type: "FullTime", jobAdCount: 2 }],
      employmentDurations: [{ type: "Permanent", jobAdCount: 1 }],
      occupationAreas: [{ identifier: "10000", jobAdCount: 2 }],
      countries: [{ label: "Danmark", identifier: "DK", jobAdCount: 2 }],
    },
    jobAds: [
      {
        jobAdId: "job-1",
        title: "Data Engineer",
        hiringOrgName: "Acme",
        occupation: null,
        municipality: null,
        postalCode: null,
        postalDistrictName: null,
        country: "Danmark",
        publicationDate: "2026-07-01T00:00:00+02:00",
        applicationDeadline: null,
        applicationDeadlineStatus: null,
        workHourPartTime: false,
        isExternal: false,
        hasLogo: false,
        logoUrl: null,
        cvr: null,
        workPlaceAddress: "",
        conceptUriDa: "http://example.test/occupation",
        isSeen: false,
        isFavorite: false,
        description: "<p>Search results should not include this bulky HTML.</p>",
      },
      {
        jobAdId: "job-2",
        title: "Analytics Engineer",
        hiringOrgName: "Example Co",
        occupation: "Softwareudvikler",
        municipality: "København",
        postalCode: 2100,
        postalDistrictName: "København Ø",
        country: "Danmark",
        publicationDate: "2026-07-02T00:00:00+02:00",
        applicationDeadline: "2026-08-01T23:59:00+02:00",
        applicationDeadlineStatus: "ExpirationDate",
        workHourPartTime: false,
        isExternal: true,
        hasLogo: true,
        logoUrl: "/logo/job-2",
        cvr: "12345678",
        workPlaceAddress: "Examplevej 1",
        isSeen: false,
        isFavorite: true,
      },
    ],
  };
}

describe("Jobnet search normalization", () => {
  test("builds the API query with required paging and optional filters", () => {
    expect(buildSearchParams(flags)).toEqual({
      resultsPerPage: "25",
      pageNumber: "2",
      orderType: "BestMatch",
      searchString: "data engineer",
      regions: "HovedstadenOgBornholm",
      workHoursType: "FullTime",
      employmentDurationType: "Permanent",
      jobAnnouncementType: "Ordinaert",
      postalCode: "2100",
      kmRadius: "25",
      occupationAreas: "10000",
      occupationGroups: "10060",
    });
  });

  test("omits radius when postal-code is absent", () => {
    const params = buildSearchParams({ ...flags, "postal-code": undefined });
    expect(params.postalCode).toBeUndefined();
    expect(params.kmRadius).toBeUndefined();
  });

  test("creates the documented output envelope and omits bulky descriptions", () => {
    const output = createSearchOutput(apiResponse(), flags);

    expect(output.meta).toEqual({
      totalJobAdCount: 2,
      pageNumber: 2,
      resultsPerPage: 25,
      searchString: "data engineer",
    });
    expect(output.facets.regions).toEqual([{ type: "HovedstadenOgBornholm", jobAdCount: 2 }]);
    expect(output.results).toHaveLength(1);
    expect(output.results[0]).toMatchObject({
      jobAdId: "job-1",
      occupation: null,
      municipality: null,
      postalCode: null,
      applicationDeadline: null,
      workPlaceAddress: "",
    });
    expect("description" in output.results[0]).toBe(false);
  });
});
