import { describe, expect, test } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

interface SearchResult {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  date: string | null;
  url: string;
  tjm: number | null;
  tags: string[];
  filled: boolean;
}

interface SearchResponse {
  meta: { count: number; page: number; matched: number; boardSize: number };
  results: SearchResult[];
}

describe("search (live)", () => {
  test("returns real, complete results for a common query", async () => {
    const res = await runCLI(["search", "-q", "developpeur", "--limit", "5"]);
    expect(res.exitCode).toBe(0);

    const body = parseJSON<SearchResponse>(res);
    expect(body.meta.page).toBe(1);
    expect(body.meta.boardSize).toBeGreaterThan(0);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.length).toBe(body.meta.count);

    for (const job of body.results) {
      expect(job.id).toBeTruthy();
      expect(job.title).toBeTruthy();
      expect(job.url).toStartWith("https://nextmondays.com/jobs/");
      // The board never names the end client — this must stay explicit, not omitted.
      expect(job.company).toBeNull();
      expect(Array.isArray(job.tags)).toBe(true);
    }
  });

  test("excludes filled missions by default and includes them on request", async () => {
    const withoutFilled = parseJSON<SearchResponse>(await runCLI(["search"]));
    const withFilled = parseJSON<SearchResponse>(await runCLI(["search", "--include-filled"]));

    expect(withoutFilled.results.every((j) => j.filled === false)).toBe(true);
    expect(withFilled.meta.matched).toBeGreaterThanOrEqual(withoutFilled.meta.matched);
  });

  test("--tjm-min filters on the published daily rate", async () => {
    const body = parseJSON<SearchResponse>(await runCLI(["search", "--tjm-min", "550"]));
    for (const job of body.results) {
      expect(job.tjm).not.toBeNull();
      expect(job.tjm!).toBeGreaterThanOrEqual(550);
    }
  });

  test("query matching is accent-insensitive", async () => {
    const plain = parseJSON<SearchResponse>(await runCLI(["search", "-q", "developpeur"]));
    const accented = parseJSON<SearchResponse>(await runCLI(["search", "-q", "développeur"]));
    expect(accented.meta.matched).toBe(plain.meta.matched);
  });

  test("table format renders a header and rows", async () => {
    const res = await runCLI(["search", "--limit", "3", "--format", "table"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("TITLE");
    expect(res.stdout).toContain("TJM");
  });
});

describe("detail (live)", () => {
  test("returns a readable description for a mission from search", async () => {
    const body = parseJSON<SearchResponse>(await runCLI(["search", "--limit", "1"]));
    const id = body.results[0]!.id;

    const res = await runCLI(["detail", id]);
    expect(res.exitCode).toBe(0);

    const job = parseJSON<{ id: string; title: string; description: string | null; url: string }>(res);
    expect(job.id).toBe(id);
    expect(job.title).toBeTruthy();
    expect(job.description).toBeTruthy();
    // Entities decoded and tags stripped.
    expect(job.description!).not.toContain("&#x");
    expect(job.description!).not.toContain("<br");
  });

  test("accepts a full mission URL as well as a bare id", async () => {
    const body = parseJSON<SearchResponse>(await runCLI(["search", "--limit", "1"]));
    const { id, url } = body.results[0]!;
    const res = await runCLI(["detail", url]);
    expect(res.exitCode).toBe(0);
    expect(parseJSON<{ id: string }>(res).id).toBe(id);
  });
});

describe("error handling", () => {
  test("an unknown flag exits 1 with a JSON error on stderr", async () => {
    const res = await runCLI(["search", "--bogus", "x"]);
    expect(res.exitCode).toBe(1);
    expect(res.stdout).toBe("");
    expect(JSON.parse(res.stderr).code).toBe("BAD_ARG");
  });

  test("a non-numeric --tjm-min exits 1 with a JSON error on stderr", async () => {
    const res = await runCLI(["search", "--tjm-min", "abc"]);
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stderr).code).toBe("BAD_ARG");
  });

  test("detail without an id exits 1 with a JSON error on stderr", async () => {
    const res = await runCLI(["detail"]);
    expect(res.exitCode).toBe(1);
    expect(res.stdout).toBe("");
    expect(JSON.parse(res.stderr).code).toBe("NO_ID");
  });

  test("detail with an unknown id exits 1 with NOT_FOUND", async () => {
    const res = await runCLI(["detail", "00Z000000"]);
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stderr).code).toBe("NOT_FOUND");
  });

  test("an unknown command exits 1 with a JSON error on stderr", async () => {
    const res = await runCLI(["frobnicate"]);
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stderr).code).toBe("BAD_CMD");
  });
});
