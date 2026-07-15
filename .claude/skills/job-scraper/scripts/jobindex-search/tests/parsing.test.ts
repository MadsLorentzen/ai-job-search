import { describe, test, expect } from "bun:test";
import { parseJobCards } from "../src/helpers";

// Minimal jobad-wrapper markup: parseJobCards splits on `jobad-wrapper-<id>`
// and reads the title from the <h4><a href>…</a></h4> and the company from the
// jix-toolbar-top__company link. We inject HTML entities to exercise decoding.
function card(id: string, title: string, company = "Acme A/S"): string {
  return `<div id="jobad-wrapper-${id}" class="PaidJob">
    <h4><a href="https://www.jobindex.dk/jobannonce/${id}">${title}</a></h4>
    <div class="jix-toolbar-top__company">
      <a href="https://www.jobindex.dk/virksomhed/acme">${company}</a>
    </div>
  </div>`;
}

describe("decodeHtmlEntities (via parseJobCards)", () => {
  test("decodes hexadecimal numeric entities (&#xF8; -> ø)", () => {
    const [c] = parseJobCards(card("h1", "Sm&#xF8;rrebro Chef"));
    expect(c.title).toBe("Smørrebro Chef");
  });

  test("decodes uppercase-X hexadecimal entities (&#XE6; -> æ)", () => {
    const [c] = parseJobCards(card("h2", "K&#XE6;re Kollega"));
    expect(c.title).toBe("Kære Kollega");
  });

  test("still decodes decimal numeric entities (&#229; -> å) — regression", () => {
    const [c] = parseJobCards(card("h3", "&#229;rhus Lead"));
    expect(c.title).toBe("århus Lead");
  });

  test("decodes supplementary-plane code points with fromCodePoint (&#128512;)", () => {
    const [c] = parseJobCards(card("h4", "Growth &#128512;"));
    expect(c.title).toBe("Growth 😀");
  });

  test("decodes hex supplementary-plane code points (&#x1F600;)", () => {
    const [c] = parseJobCards(card("h5", "Growth &#x1F600;"));
    expect(c.title).toBe("Growth 😀");
  });

  test("decodes hex entities in the company name too", () => {
    const [c] = parseJobCards(card("h6", "Engineer", "N&#xF8;rrebro ApS"));
    expect(c.company).toBe("Nørrebro ApS");
  });
});
