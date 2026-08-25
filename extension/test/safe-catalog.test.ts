import { describe, expect, it } from "vitest";
import { SAFE_CATALOG_FIELD_TYPES, matchSafeCatalogField } from "../src/adapters/safe-catalog";

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
