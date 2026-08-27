import { describe, expect, it } from "vitest";
import {
  SAFE_CATALOG_FIELD_TYPES,
  matchSafeCatalogFieldForAdapter,
} from "../src/adapters/safe-catalog";

describe("safe catalog", () => {
  it("contains exactly six universal fields", () => {
    expect(SAFE_CATALOG_FIELD_TYPES).toEqual([
      "name", "email", "phone", "linkedin", "github", "location",
    ]);
  });

  // The raw, unguarded matcher (formerly `matchSafeCatalogField`) is no
  // longer exported — every adapter must go through
  // `matchSafeCatalogFieldForAdapter` so the context guards can never be
  // bypassed. Its behavior is still fully covered here, indirectly, through
  // the guarded function: none of these labels trip either guard, so the
  // guarded function's output equals what the raw matcher would have
  // returned.
  it("matches an email label to the email field type", () => {
    expect(matchSafeCatalogFieldForAdapter("Email address")).toBe("email");
  });

  it("matches a LinkedIn label to the linkedin field type", () => {
    expect(matchSafeCatalogFieldForAdapter("LinkedIn profile URL")).toBe("linkedin");
  });

  it("returns null for a field outside the safe catalog", () => {
    expect(matchSafeCatalogFieldForAdapter("Desired salary")).toBeNull();
  });

  it("returns null for an employment field even though it sounds similar", () => {
    expect(matchSafeCatalogFieldForAdapter("Current employer")).toBeNull();
  });

  it("matches 'First Name' to the name field type", () => {
    expect(matchSafeCatalogFieldForAdapter("First Name")).toBe("name");
  });

});

describe("matchSafeCatalogFieldForAdapter (third-party name guard)", () => {
  it("does not match 'Reference Name' (third-party context qualifier present)", () => {
    expect(matchSafeCatalogFieldForAdapter("Reference Name")).toBeNull();
  });

  it("does not match 'Reference First Name' (third-party context qualifier present)", () => {
    expect(matchSafeCatalogFieldForAdapter("Reference First Name")).toBeNull();
  });

  it("does not match 'Third-party First Name'", () => {
    expect(matchSafeCatalogFieldForAdapter("Third-party First Name")).toBeNull();
  });

  it("does not match employer/company-scoped first-name fields", () => {
    expect(matchSafeCatalogFieldForAdapter("Employer First Name")).toBeNull();
    expect(matchSafeCatalogFieldForAdapter("Company First Name")).toBeNull();
  });

  it("does not match 'Recruiter Name' (third-party context qualifier present)", () => {
    expect(matchSafeCatalogFieldForAdapter("Recruiter Name")).toBeNull();
  });

  it("does not match 'Hiring Manager Name' (third-party context qualifier present)", () => {
    expect(matchSafeCatalogFieldForAdapter("Hiring Manager Name")).toBeNull();
  });

  it("does not match 'Emergency Contact Name' (third-party context qualifier present)", () => {
    expect(matchSafeCatalogFieldForAdapter("Emergency Contact Name")).toBeNull();
  });

  it("does not match 'Supervisor Name' (third-party context qualifier present)", () => {
    expect(matchSafeCatalogFieldForAdapter("Supervisor Name")).toBeNull();
  });

  it("is case-insensitive for the third-party name guard", () => {
    expect(matchSafeCatalogFieldForAdapter("REFERENCE NAME")).toBeNull();
  });

  it("still matches a bare 'Name' label with no third-party qualifier", () => {
    expect(matchSafeCatalogFieldForAdapter("Your Name")).toBe("name");
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

  it("is case-insensitive and whitespace-tolerant for the employer-context guard", () => {
    expect(matchSafeCatalogFieldForAdapter("EMPLOYER LOCATION")).toBeNull();
    expect(matchSafeCatalogFieldForAdapter("employer   Location")).toBeNull();
  });
});

describe("matchSafeCatalogFieldForAdapter (work/office location phrase guard)", () => {
  // Fix: "Work location" and "Office location" are just as ambiguous as
  // "Employer location" (candidate's own address vs. a job's worksite
  // address), so they must NOT autofill. This is a narrow phrase-adjacency
  // pattern (work/office immediately followed by "location"), not a bare
  // qualifier word, specifically so it does not collide with legitimate
  // labels like "Work email" or "Office phone".
  it("does not match 'Work location' (work/office location phrase present)", () => {
    expect(matchSafeCatalogFieldForAdapter("Work location")).toBeNull();
  });

  it("does not match 'Office location' (work/office location phrase present)", () => {
    expect(matchSafeCatalogFieldForAdapter("Office location")).toBeNull();
  });

  it("still matches 'Work email' as email (no false suppression)", () => {
    expect(matchSafeCatalogFieldForAdapter("Work email")).toBe("email");
  });

  it("still matches 'Work phone' as phone (no false suppression)", () => {
    expect(matchSafeCatalogFieldForAdapter("Work phone")).toBe("phone");
  });

  it("still matches 'Office phone' as phone (no false suppression)", () => {
    expect(matchSafeCatalogFieldForAdapter("Office phone")).toBe("phone");
  });

  it("is case-insensitive and separator-tolerant for the work/office location phrase", () => {
    expect(matchSafeCatalogFieldForAdapter("OFFICE LOCATION")).toBeNull();
    expect(matchSafeCatalogFieldForAdapter("office  location")).toBeNull();
    expect(matchSafeCatalogFieldForAdapter("Office Location:")).toBeNull();
    expect(matchSafeCatalogFieldForAdapter("Work-Location")).toBeNull();
  });
});
