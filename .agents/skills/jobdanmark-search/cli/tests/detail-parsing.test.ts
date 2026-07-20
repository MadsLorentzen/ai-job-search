import { describe, expect, test } from "bun:test";
import { parseJobPostingFromHtml } from "../src/commands/detail";

const HTML_WITHOUT_JSON_LD = `<!doctype html>
<html lang="da">
  <head>
    <title>Journalistisk udvikler s&#xF8;ges | jobdanmark</title>
  </head>
  <body>
    <div class="job-list-details">
      <div class="job-details-head row mx-0">
        <div class="company-logo col-auto">
          <img src="/media/jfm-logo.png?width=100" alt="JFM">
        </div>
        <h3 class="title">Journalistisk udvikler s&#xF8;ges</h3>
        <a href="/virksomheder/jfm">JFM</a>
        <span>Baneg&#xE5;rdspladsen 1, 5000 Odense C</span>
      </div>
      <p>Hvad nu hvis du med f&#xE5; klik kunne unders&#xF8;ge dit lokalomr&#xE5;de?</p>
      <ul>
        <li>identificere relevante datas&#xE6;t og muligheder</li>
      </ul>
    </div>
    <a href="https://jfm.career.emply.com/da/apply/example" class="action primary count-click">Ans&#xF8;g nu</a>
    <ul class="job-overview list-unstyled">
      <li><strong>Udgivet:</strong> 03-07-2026</li>
      <li><strong>Jobtype:</strong> Fuldtid</li>
      <li><strong>Arbejdssted:</strong> Baneg&#xE5;rdspladsen 1, 5000 Odense C</li>
      <li><strong>Ansøgningsfrist:</strong> 02-08-2026 23.59</li>
    </ul>
  </body>
</html>`;

describe("parseJobPostingFromHtml", () => {
  test("falls back to rendered Jobdanmark HTML when JSON-LD is absent", () => {
    const parsed = parseJobPostingFromHtml(
      HTML_WITHOUT_JSON_LD,
      "journalistisk-udvikler",
      "https://jobdanmark.dk/job/journalistisk-udvikler",
    );

    expect(parsed.title).toBe("Journalistisk udvikler søges");
    expect(parsed.datePosted).toBe("03-07-2026");
    expect(parsed.validThrough).toBe("02-08-2026 23.59");
    expect(parsed.employmentType).toEqual(["Fuldtid"]);
    expect(parsed.hiringOrganization.name).toBe("JFM");
    expect(parsed.hiringOrganization.logo).toBe("https://jobdanmark.dk/media/jfm-logo.png?width=100");
    expect(parsed.jobLocation.streetAddress).toBe("Banegårdspladsen 1, 5000 Odense C");
    expect(parsed.description).toContain("identificere relevante datasæt");
    expect(parsed.applyUrl).toBe("https://jfm.career.emply.com/da/apply/example");
  });

  test("does not reject titles containing '404' mid-phrase", () => {
    const htmlWith404InTitle = HTML_WITHOUT_JSON_LD.replace(
      "<title>Journalistisk udvikler s&#xF8;ges | jobdanmark</title>",
      "<title>HTTP 404 Page Designer | jobdanmark</title>",
    ).replace(
      '<h3 class="title">Journalistisk udvikler s&#xF8;ges</h3>',
      '<h3 class="title">HTTP 404 Page Designer</h3>',
    );

    const parsed = parseJobPostingFromHtml(
      htmlWith404InTitle,
      "http-404-designer",
      "https://jobdanmark.dk/job/http-404-designer",
    );

    expect(parsed.title).toBe("HTTP 404 Page Designer");
    expect(parsed.hiringOrganization.name).toBe("JFM");
  });
});
