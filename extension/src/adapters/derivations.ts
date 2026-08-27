import type { CandidateSnapshot } from "./types";

export interface Derivation {
  id: string;
  version: string;
  compute(snapshot: CandidateSnapshot): string | null;
}

function parseStartYear(dateRange: string): number | null {
  const match = dateRange.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

// Provenance for a value produced by this function must carry this
// derivation's id/version alongside the pack facts it was computed from
// (design spec Section 11.4), so it is never mistaken for a literal
// candidate-snapshot fact.
export const yearsOfExperienceFromEmploymentDates: Derivation = {
  id: "years_of_experience_from_employment_dates",
  version: "1",
  compute(snapshot: CandidateSnapshot): string | null {
    const startYears = snapshot.employment
      .map((entry) => entry.date_range?.value)
      .filter((value): value is string => Boolean(value))
      .map(parseStartYear)
      .filter((year): year is number => year !== null);
    if (startYears.length === 0) return null;
    const earliest = Math.min(...startYears);
    const currentYear = new Date().getFullYear();
    return String(currentYear - earliest);
  },
};
