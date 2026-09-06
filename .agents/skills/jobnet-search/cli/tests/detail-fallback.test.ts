import { describe, expect, test } from "bun:test"
import { mapSearchAdToDetail } from "../src/commands/detail"
import type { JobAdRaw } from "../src/commands/search"

describe("mapSearchAdToDetail (Issue #432 external ad fallback)", () => {
  const sampleAd: JobAdRaw & { jobAdUrl?: string; jobAnnouncementTypeName?: string } = {
    jobAdId: "ext-123",
    title: "AI Technical Artist",
    hiringOrgName: "Tactile Games",
    occupation: "Programmør og systemudvikler",
    conceptUriDa: "http://data.star.dk/esco/occupation/8b6456a3-ae9a-45a0-a65b-fed797521753",
    jobAnnouncementTypeName: "Almindelige vilkår",
    workHourPartTime: false,
    jobAdUrl: "https://job-boards.eu.greenhouse.io/tactilegames/jobs/4890782101",
    hasLogo: true,
    logoUrl: "/bff/logo/123",
    workPlaceAddress: "  Trekronergade 26  ",
    cvr: "32319882",
    description: "<p>Great job opening at Tactile.</p>",
    applicationDeadline: "2026-12-05T00:00:00+01:00",
    applicationDeadlineStatus: "ExpirationDate",
    country: "Danmark",
    municipality: "København",
    postalCode: 2500,
    postalDistrictName: "Valby",
    publicationDate: "2026-09-05T00:00:00+02:00",
    isExternal: true,
    isSeen: false,
    isFavorite: false,
  }

  test("maps all key fields correctly to DetailApiResponse format", () => {
    const detail = mapSearchAdToDetail(sampleAd)

    expect(detail.id).toBe("ext-123")
    expect(detail.title).toBe("AI Technical Artist")
    expect(detail.body).toBe("<p>Great job opening at Tactile.</p>")
    expect(detail.publicationDateTime).toBe("2026-09-05T00:00:00+02:00")
    expect(detail.employer.name).toBe("Tactile Games")
    expect(detail.employer.cvrNumber).toBe("32319882")
    expect(detail.employer.hasCompanyLogo).toBe(true)
    expect(detail.job.type).toBe("Almindelige vilkår")
    expect(detail.job.address.streetName).toBe("Trekronergade 26")
    expect(detail.job.address.city).toBe("Valby")
    expect(detail.job.address.postalCode).toBe("2500")
    expect(detail.job.address.municipality).toBe("København")
    expect(detail.job.address.countryCode).toBe("DK")
    expect(detail.job.address.countryName).toBe("Danmark")
    expect(detail.job.isPartTime).toBe(false)
    expect(detail.job.preferredLabelDa).toBe("Programmør og systemudvikler")
    expect(detail.job.conceptUriDa).toBe("http://data.star.dk/esco/occupation/8b6456a3-ae9a-45a0-a65b-fed797521753")
    expect(detail.application.deadlineDate).toBe("2026-12-05T00:00:00+01:00")
    expect(detail.application.url).toBe("https://job-boards.eu.greenhouse.io/tactilegames/jobs/4890782101")
    expect(detail.application.isApplicationDeadlineASAP).toBe(false)
  })

  test("handles empty or whitespace address gracefully", () => {
    const detail = mapSearchAdToDetail({
      ...sampleAd,
      workPlaceAddress: "   ",
      postalDistrictName: null,
      municipality: null,
      postalCode: null,
    })

    expect(detail.job.address.streetName).toBeNull()
    expect(detail.job.address.city).toBeNull()
    expect(detail.job.address.postalCode).toBeNull()
    expect(detail.job.address.municipality).toBeNull()
  })

  test("flags undisclosed deadline as ASAP", () => {
    const detail = mapSearchAdToDetail({
      ...sampleAd,
      applicationDeadlineStatus: "NotDisclosed",
    })

    expect(detail.application.isApplicationDeadlineASAP).toBe(true)
  })
})
