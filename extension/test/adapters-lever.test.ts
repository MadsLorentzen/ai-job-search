import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { leverAdapter } from "../src/adapters/lever";

function loadFixture(): Document {
  const html = readFileSync(new URL("./fixtures/lever.html", import.meta.url), "utf-8");
  return new JSDOM(html).window.document;
}

describe("lever adapter", () => {
  it("detects a Lever-shaped application form", () => {
    expect(leverAdapter.detect(loadFixture())).toBe(true);
  });

  it("autofills only the safe catalog fields", () => {
    const document = loadFixture();
    const fields = leverAdapter.scan(document);
    const byLabel = Object.fromEntries(fields.map((f) => [f.labelText, f]));
    expect(leverAdapter.classify(byLabel["Full name"]).behavior).toBe("autofill");
    expect(leverAdapter.classify(byLabel["Email"]).behavior).toBe("autofill");
  });

  it("classifies the free-text additional-information field as ask", () => {
    const document = loadFixture();
    const fields = leverAdapter.scan(document);
    const additional = fields.find((f) => f.labelText === "Additional Information")!;
    expect(leverAdapter.classify(additional).behavior).toBe("ask");
  });

  it("classifies the certification checkbox as never", () => {
    const document = loadFixture();
    const fields = leverAdapter.scan(document);
    const cert = fields.find((f) => f.labelText.includes("certify"))!;
    expect(leverAdapter.classify(cert).behavior).toBe("never");
  });
});
