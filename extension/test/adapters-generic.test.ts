import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { genericAdapter } from "../src/adapters/generic";

function loadFixture(): Document {
  const html = readFileSync(new URL("./fixtures/generic.html", import.meta.url), "utf-8");
  return new JSDOM(html).window.document;
}

describe("generic adapter", () => {
  it("detects any form with at least one recognizable input", () => {
    expect(genericAdapter.detect(loadFixture())).toBe(true);
  });

  it("classifies name/email/phone as autofill from the safe catalog", () => {
    const document = loadFixture();
    const fields = genericAdapter.scan(document);
    const byLabel = Object.fromEntries(fields.map((f) => [f.labelText, f]));

    expect(genericAdapter.classify(byLabel["Full Name"]).behavior).toBe("autofill");
    expect(genericAdapter.classify(byLabel["Email address"]).behavior).toBe("autofill");
    expect(genericAdapter.classify(byLabel["Phone"]).behavior).toBe("autofill");
  });

  it("classifies an unrecognized field as ask, never escalated", () => {
    const document = loadFixture();
    const fields = genericAdapter.scan(document);
    const salary = fields.find((f) => f.labelText === "Desired salary")!;
    expect(genericAdapter.classify(salary).behavior).toBe("ask");
  });

  it("classifies a certification checkbox as never", () => {
    const document = loadFixture();
    const fields = genericAdapter.scan(document);
    const cert = fields.find((f) => f.labelText.includes("certify"))!;
    expect(genericAdapter.classify(cert).behavior).toBe("never");
  });

  it("every FieldDecision carries the adapter id and version", () => {
    const document = loadFixture();
    const fields = genericAdapter.scan(document);
    for (const field of fields) {
      const decision = genericAdapter.classify(field);
      expect(decision.adapterId).toBe("generic");
      expect(decision.adapterVersion).toBe("generic@1");
    }
  });

  it("does not autofill an employer/company/institution location field with the candidate's own location", () => {
    const document = loadFixture();
    const fields = genericAdapter.scan(document);
    const employerLocation = fields.find((f) => f.labelText === "Employer location")!;

    const decision = genericAdapter.classify(employerLocation);
    expect(decision.behavior).toBe("ask");
    expect(decision.sourceKind).not.toBe("safe_fact");

    // classify() and map() must agree: if classify() refuses to autofill,
    // map() must never independently return a value for the same field.
    const snapshot = {
      identity: { name: { value: "Jane Doe", profile_evidence_ids: [] } },
      contact: {
        location: { value: "Copenhagen, Denmark", profile_evidence_ids: [] },
      },
      employment: [],
    };
    expect(genericAdapter.map(employerLocation, snapshot)).toBeNull();
  });
});
