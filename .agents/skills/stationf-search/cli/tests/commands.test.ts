import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// Live tests hit the real portal, so they are opt-in: CI (and a plane) must stay
// green offline. Run them with `PORTAL_LIVE_TESTS=1 bun test` — they are the
// tripwire for the portal changing its markup, key, or record shape.
const LIVE = process.env.PORTAL_LIVE_TESTS === "1";

// Live smoke tests: they hit the real board, so they are deliberately few and
// small (one search, one detail). If the board is unreachable or rate-limits the
// run, these fail loudly — that is the point: they are the tripwire for the
// board changing its markup or its Algolia setup.

interface SearchResponse {
  meta: { count: number; page: number; total: number };
  results: Array<{
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    date: string | null;
    url: string;
    contract: string | null;
  }>;
}

describe.skipIf(!LIVE)("stationf CLI — live", () => {
  test(
    "search returns real, fully-populated results",
    async () => {
      const result = await runCLI(["search", "-q", "engineer", "--limit", "5"]);
      const body = parseJSON<SearchResponse>(result);

      expect(body.meta.page).toBe(1);
      expect(body.results.length).toBeGreaterThan(0);

      for (const job of body.results) {
        expect(job.id).toMatch(/^[^/]+\/[^/]+$/);
        expect(job.title.length).toBeGreaterThan(0);
        // A parser half-broken by a markup change shows up here first.
        expect(job.title).not.toMatch(/[<>]|&(amp|lt|gt|#\d+);/);
        expect(job.url).toStartWith("https://jobs.stationf.co/companies/");
        expect(job.company).not.toBe("");
      }
      // Every result must carry a company; a null across the board means the
      // record shape moved.
      expect(body.results.some((j) => j.company)).toBe(true);
    },
    45000,
  );

  test(
    "the contract filter reaches Algolia (CDI-only results)",
    async () => {
      const result = await runCLI(["search", "--contract", "cdi", "--limit", "5"]);
      const body = parseJSON<SearchResponse>(result);
      expect(body.results.length).toBeGreaterThan(0);
      for (const job of body.results) expect(job.contract).toBe("CDI");
    },
    45000,
  );

  test(
    "detail on a live search result returns readable text",
    async () => {
      const search = await runCLI(["search", "-q", "engineer", "--limit", "1"]);
      const body = parseJSON<SearchResponse>(search);
      expect(body.results.length).toBeGreaterThan(0);

      const detail = await runCLI(["detail", body.results[0].id, "--format", "plain"]);
      expect(detail.exitCode).toBe(0);
      expect(detail.stdout.length).toBeGreaterThan(200);
      // Entities decoded and tags stripped, not raw markup.
      expect(detail.stdout).not.toMatch(/<\/?(p|div|li|br)\b/i);
      expect(detail.stdout).not.toMatch(/&(amp|nbsp|#\d+);/);
      expect(detail.stdout).toMatch(/URL: https:\/\/jobs\.stationf\.co\//);
    },
    60000,
  );

  test(
    "a job id that does not exist exits 1 with a JSON error on stderr",
    async () => {
      const result = await runCLI(["detail", "no-such-company/no-such-job"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      const err = JSON.parse(result.stderr);
      expect(["NOT_FOUND", "PARSE_FAILED"]).toContain(err.code);
    },
    45000,
  );
});
