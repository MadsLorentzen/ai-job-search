import { describe, expect, it } from "vitest";
import { isLegalDeclarationField } from "../src/adapters/legal-patterns";

describe("legal declaration detection", () => {
  it("flags a certification checkbox label", () => {
    expect(isLegalDeclarationField("I certify that the information above is true and correct")).toBe(true);
  });

  it("flags an e-signature field", () => {
    expect(isLegalDeclarationField("Electronic signature")).toBe(true);
  });

  it("flags an attestation checkbox", () => {
    expect(isLegalDeclarationField("I attest that I am legally authorized to work")).toBe(true);
  });

  it("does not flag an ordinary text field", () => {
    expect(isLegalDeclarationField("Cover letter")).toBe(false);
  });

  it("does not flag the shared safe catalog fields", () => {
    expect(isLegalDeclarationField("Email address")).toBe(false);
  });
});
