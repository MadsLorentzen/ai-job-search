import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// Live tests hit the real portal, so they are opt-in: CI (and a plane) must stay
// green offline. Run them with `PORTAL_LIVE_TESTS=1 bun test` — they are the
// tripwire for the portal changing its markup, key, or record shape.
const LIVE = process.env.PORTAL_LIVE_TESTS === "1";

// Live smoke tests: they hit the real site, so they are deliberately few and
// small (a couple of searches, one detail) — personal-use volume. They are the
// tripwire for the site rotating its Algolia key or changing its record shape.

interface SearchResponse {
  meta: { count: number; page: number; total: number; window: number };
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

describe.skipIf(!LIVE)("wttj CLI — live", () => {
  test(
    "search returns real, fully-populated results",
    async () => {
      const result = await runCLI(["search", "-q", "data engineer", "-l", "Paris", "--limit", "5"]);
      const body = parseJSON<SearchResponse>(result);

      expect(body.meta.page).toBe(1);
      expect(body.results.length).toBeGreaterThan(0);

      for (const job of body.results) {
        expect(job.id).toMatch(/^[^/]+\/[^/]+$/);
        expect(job.title.length).toBeGreaterThan(0);
        // A parser half-broken by a shape change shows up here first.
        expect(job.title).not.toMatch(/[<>]|&(amp|lt|gt|#\d+);/);
        expect(job.url).toStartWith("https://www.welcometothejungle.com/fr/companies/");
        expect(job.location).toContain("Paris");
      }
      expect(body.results.some((j) => j.company)).toBe(true);
    },
    45000,
  );

  test(
    "dedup means no posting is listed twice (WTTJ repeats records per website)",
    async () => {
      const result = await runCLI(["search", "-q", "engineer", "-l", "Paris", "--limit", "20"]);
      const body = parseJSON<SearchResponse>(result);
      const ids = body.results.map((j) => j.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
    45000,
  );

  test(
    "--jobage uses the date-sorted replica and returns only recent postings",
    async () => {
      const result = await runCLI(["search", "-l", "Paris", "--jobage", "7", "--limit", "5"]);
      const body = parseJSON<SearchResponse>(result);
      expect(body.results.length).toBeGreaterThan(0);
      const cutoff = Date.now() - 8 * 86400000; // a day of slack for timezones
      for (const job of body.results) {
        expect(job.date).not.toBeNull();
        expect(Date.parse(job.date!)).toBeGreaterThan(cutoff);
      }
    },
    45000,
  );

  test(
    "detail on a live search result returns readable text",
    async () => {
      const search = await runCLI(["search", "-q", "data engineer", "-l", "Paris", "--limit", "1"]);
      const body = parseJSON<SearchResponse>(search);
      expect(body.results.length).toBeGreaterThan(0);

      // Either source is a pass: the point is that `detail` produces usable output
      // even while the WAF is throttling. The full page path is verified against a
      // captured response in detail-page.test.ts, which does not depend on the
      // site being reachable.
      const detail = await runCLI(["detail", body.results[0].id, "--format", "plain"]);
      expect(detail.exitCode).toBe(0);
      expect(detail.stdout).not.toMatch(/<\/?(p|div|li|br)\b/i);
      expect(detail.stdout).not.toMatch(/&(amp|nbsp|#\d+);/);
      expect(detail.stdout).toMatch(/URL: https:\/\/www\.welcometothejungle\.com\/fr\//);

      const json = await runCLI(["detail", body.results[0].id]);
      const parsed = JSON.parse(json.stdout) as { source: string; description: string | null };
      expect(["page", "index"]).toContain(parsed.source);
      if (parsed.source === "page") expect(parsed.description!.length).toBeGreaterThan(200);
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
      // WAF_CHALLENGE is a legitimate outcome here: when the site is throttling,
      // a missing job is indistinguishable from a blocked one, and the CLI says
      // so rather than reporting a confident NOT_FOUND it cannot support.
      expect(["NOT_FOUND", "PARSE_FAILED", "WAF_CHALLENGE"]).toContain(err.code);
    },
    45000,
  );
});
