import { describe, expect, test } from "bun:test";
import { parseSearchPage } from "../src/helpers";

// parseSearchPage had no tests at all: mutating total to stop using
// sr.hitcount survived the whole suite (review finding F35, 2026-08-19).
// The fixture mirrors the real Stash nesting documented in helpers.ts:
// jobsearch/result_app -> storeData -> searchResponse -> { hitcount, results[] }.
function stashPage(searchResponse: object): string {
  const stash = { jobsearch: { result_app: { storeData: { searchResponse } } } };
  return `<html><head><script>var Stash = ${JSON.stringify(stash)};</script></head></html>`;
}

const RESULT = {
  tid: "h1689961",
  headline: "Softwareudvikler",
  company: { name: "Acme A/S", homeurl: "https://acme.example" },
  area: "Aarhus",
  firstdate: "2026-08-10",
  apply_deadline: "2026-09-11T00:00:00",
};

describe("parseSearchPage", () => {
  test("total comes from hitcount, not the page's result count", () => {
    const page = stashPage({ hitcount: 435, results: [RESULT] });
    const parsed = parseSearchPage(page);
    expect(parsed.total).toBe(435);
    expect(parsed.results).toHaveLength(1);
  });

  test("total falls back to the result count when hitcount is absent", () => {
    const page = stashPage({ results: [RESULT, { ...RESULT, tid: "h2" }] });
    expect(parseSearchPage(page).total).toBe(2);
  });

  test("maps the contract fields from a Stash result", () => {
    const [job] = parseSearchPage(stashPage({ hitcount: 1, results: [RESULT] })).results;
    expect(job).toMatchObject({
      id: "h1689961",
      title: "Softwareudvikler",
      company: "Acme A/S",
      location: "Aarhus",
      date: "2026-08-10",
      deadline: "2026-09-11",
      url: "https://www.jobindex.dk/jobannonce/h1689961",
    });
  });

  test("maps an ASAP posting's deadline to null (no stated deadline)", () => {
    // apply_deadline_asap means "no fixed deadline, apply now". The /scrape
    // schema defines null as exactly that, and every consumer (rank's expiry
    // sweep, notion-sync's typed date column) does date arithmetic on this
    // field - a bare "ASAP" string broke all of them on half of live results
    // (review finding F12, 2026-08-19). lastdate present too: the flag wins.
    const [job] = parseSearchPage(
      stashPage({
        hitcount: 1,
        results: [{ ...RESULT, apply_deadline: undefined, apply_deadline_asap: true, lastdate: "2026-09-30" }],
      }),
    ).results;
    expect(job.deadline).toBeNull();
  });

  test("falls back to lastdate when apply_deadline is absent", () => {
    const [job] = parseSearchPage(
      stashPage({ hitcount: 1, results: [{ ...RESULT, apply_deadline: undefined, lastdate: "2026-09-30" }] }),
    ).results;
    expect(job.deadline).toBe("2026-09-30");
  });
});
