import { describe, expect, it } from "vitest";
import {
  SAFE_CATALOG_FIELD_TYPES,
  matchSafeCatalogField,
  matchSafeCatalogFieldForAdapter,
} from "../src/adapters/safe-catalog";

describe("safe catalog", () => {
  it("contains exactly six universal fields", () => {
    expect(SAFE_CATALOG_FIELD_TYPES).toEqual([
      "name", "email", "phone", "linkedin", "github", "location",
    ]);
  });

  it("matches an email label to the email field type", () => {
    expect(matchSafeCatalogField("Email address")).toBe("email");
  });

  it("matches a LinkedIn label to the linkedin field type", () => {
    expect(matchSafeCatalogField("LinkedIn profile URL")).toBe("linkedin");
  });

  it("returns null for a field outside the safe catalog", () => {
    expect(matchSafeCatalogField("Desired salary")).toBeNull();
  });

  it("returns null for an employment field even though it sounds similar", () => {
    expect(matchSafeCatalogField("Current employer")).toBeNull();
  });
});

describe("matchSafeCatalogFieldForAdapter (employer-context guard)", () => {
  it("matches a bare 'Location' label", () => {
    expect(matchSafeCatalogFieldForAdapter("Location")).toBe("location");
  });

  it("matches a bare 'City' label", () => {
    expect(matchSafeCatalogFieldForAdapter("City")).toBe("location");
  });

  it("matches 'Current location' (no employer-context qualifier)", () => {
    expect(matchSafeCatalogFieldForAdapter("Current location")).toBe("location");
  });

  it("does not match 'Employer location' (employer-context qualifier present)", () => {
    expect(matchSafeCatalogFieldForAdapter("Employer location")).toBeNull();
  });

  it("does not match 'Company location' (employer-context qualifier present)", () => {
    expect(matchSafeCatalogFieldForAdapter("Company location")).toBeNull();
  });

  // Judgment call (documented, not silently papered over): the current
  // EMPLOYER_CONTEXT_QUALIFIER regex covers employer/company/institution/
  // university/school/organization, but NOT "office" or "work". Labels like
  // "Office location" or "Work location" are just as ambiguous as "Employer
  // location" in principle, but adding a bare "work" (or "office") qualifier
  // word would also suppress extremely common, legitimate safe-catalog
  // labels such as "Work email" or "Work phone" (and plausibly "Office
  // phone"), which SHOULD still autofill. Since a qualifier word can't be
  // scoped to "location" only without adding field-type-aware logic the
  // project owner did not ask for here, the regex is left as-is and this
  // gap is pinned explicitly by the following two tests rather than fixed
  // silently.
  it("KNOWN GAP: 'Office location' still autofills under the current qualifier regex (not extended to cover 'office')", () => {
    expect(matchSafeCatalogFieldForAdapter("Office location")).toBe("location");
  });

  it("KNOWN GAP: 'Work location' still autofills under the current qualifier regex (not extended to cover 'work')", () => {
    expect(matchSafeCatalogFieldForAdapter("Work location")).toBe("location");
  });

  it("confirms 'Work email' and 'Work phone' still autofill (why 'work' was not added as a qualifier word)", () => {
    expect(matchSafeCatalogFieldForAdapter("Work email")).toBe("email");
    expect(matchSafeCatalogFieldForAdapter("Work phone")).toBe("phone");
  });

  it("is case-insensitive and whitespace-tolerant for the employer-context guard", () => {
    expect(matchSafeCatalogFieldForAdapter("EMPLOYER LOCATION")).toBeNull();
    expect(matchSafeCatalogFieldForAdapter("employer   Location")).toBeNull();
  });
});
