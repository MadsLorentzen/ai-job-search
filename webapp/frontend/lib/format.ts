// Candidate is Atlanta-based; every timestamp in the dashboard should read in
// Eastern Time regardless of the viewer's local machine timezone.
//
// The backend serializes timestamps as naive datetime strings with no "Z" or
// offset (e.g. "2026-09-16T13:46:00.766100") -- they're really UTC, but a
// timezone-less ISO string is parsed by JS `Date` as LOCAL browser time, not
// UTC. For a viewer whose machine is already set to Eastern, that silently
// looks plausible while being off by exactly the UTC offset (confirmed live:
// an event stored ~9 minutes ago was displaying 4 hours in the future).
// Appending "Z" when the string carries no zone designator fixes the parse
// without needing a backend change.
const HAS_TIMEZONE = /[Zz]|[+-]\d{2}:?\d{2}$/;

export function formatEasternTime(value: string | number | Date): string {
  const normalized = typeof value === "string" && !HAS_TIMEZONE.test(value) ? `${value}Z` : value;
  return new Date(normalized).toLocaleString("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}
