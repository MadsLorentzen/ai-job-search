import { describe, expect, it } from "vitest";
import { yearsOfExperienceFromEmploymentDates } from "../src/adapters/derivations";
import type { CandidateSnapshot } from "../src/adapters/types";

describe("years-of-experience derivation", () => {
  it("has a stable id and version for provenance binding", () => {
    expect(yearsOfExperienceFromEmploymentDates.id).toBe(
      "years_of_experience_from_employment_dates",
    );
    expect(yearsOfExperienceFromEmploymentDates.version).toBe("1");
  });

  it("computes years from the earliest employment date_range", () => {
    const snapshot = {
      identity: { name: { value: "Test User", profile_evidence_ids: [] } },
      contact: {},
      employment: [
        { record_id: "rec_1", role: null, employer: null,
          date_range: { value: "2019 - Present", profile_evidence_ids: ["clm_1"] },
          location: null, details: [] },
      ],
    } satisfies CandidateSnapshot;
    const result = yearsOfExperienceFromEmploymentDates.compute(snapshot);
    expect(result).not.toBeNull();
  });

  it("returns null when no employment data exists", () => {
    const snapshot = {
      identity: { name: { value: "Test User", profile_evidence_ids: [] } },
      contact: {}, employment: [],
    } satisfies CandidateSnapshot;
    expect(yearsOfExperienceFromEmploymentDates.compute(snapshot)).toBeNull();
  });
});
