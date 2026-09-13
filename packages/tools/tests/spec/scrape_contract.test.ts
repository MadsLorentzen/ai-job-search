/** /scrape Step 2 search-output contract across portal CLIs. Port of
 * tests/test_scrape_contract.py (portals under .pi-agent/skills). */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS, read } from "./helpers.ts";

const SCRAPER_SKILL = `${SKILLS}/job-scraper/SKILL.md`;

const portalClis = () =>
  readdirSync(SKILLS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.endsWith("-search"))
    .map((d) => d.name)
    .sort();

function deriveContractFields(): Set<string> {
  const text = read(SCRAPER_SKILL);
  const match = /Search output already includes ([a-zA-Z0-9\s,]+)\./m.exec(text);
  if (!match) throw new Error("Step 2 contract sentence not found in job-scraper/SKILL.md");
  const fieldsText = match[1]!.replace(/\s+and\s+/g, ",");
  return new Set(
    fieldsText.split(",").map((f) => f.trim().toLowerCase()).filter(Boolean),
  );
}

describe("scrape search-output contract", () => {
  test("step2 contract sentence is found in the scraper skill", () => {
    const fields = deriveContractFields();
    for (const f of ["title", "company", "location", "date", "url"]) {
      expect(fields.has(f)).toBe(true);
    }
  });

  test("every portal CLI emits the step2 contract fields", () => {
    const contract = deriveContractFields();
    const failures: string[] = [];
    for (const portal of portalClis()) {
      const searchTs = join(SKILLS, portal, "cli", "src", "commands", "search.ts");
      if (!existsSync(searchTs)) {
        failures.push(`${portal}: no cli/src/commands/search.ts`);
        continue;
      }
      const helpersTs = join(SKILLS, portal, "cli", "src", "helpers.ts");
      const files = existsSync(helpersTs) ? [searchTs, helpersTs] : [searchTs];
      const source = files.map((f) => readFileSync(f, "utf8")).join("\n");
      const emitted = new Set(
        [...source.matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*):/gm)].map((m) => m[1]!),
      );
      const missing = [...contract].filter((f) => !emitted.has(f)).sort();
      if (missing.length > 0) failures.push(`${portal}: missing ${missing} in search output`);
    }
    expect(failures).toEqual([]);
  });
});

function deriveStoredFields(): Set<string> {
  const text = read(SCRAPER_SKILL);
  const match = /Add ALL fetched jobs[\s\S]*?```json([\s\S]*?)```/.exec(text);
  if (!match) throw new Error("Step 4 seen_jobs.json schema block not found");
  return new Set([...match[1]!.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]!));
}

describe("seen_jobs posting date", () => {
  test("step4 schema persists a posting date", () => {
    expect(deriveStoredFields().has("posted_date")).toBe(true);
  });

  test("the step2 date field survives into storage", () => {
    expect(deriveContractFields().has("date")).toBe(true);
    expect(deriveStoredFields().has("posted_date")).toBe(true);
  });

  test("posted_date semantics are documented", () => {
    const text = read(SCRAPER_SKILL);
    expect(text).toContain("`posted_date`");
    expect(text).toMatch(/never infer a posting date/);
  });
});

describe("seen_jobs dedup continuity", () => {
  test("existing urls are seen regardless of key", () => {
    expect(read(SCRAPER_SKILL)).toMatch(
      /URL matches any existing `seen_jobs\.json` entry, regardless of\s+that entry's key/,
    );
  });

  test("step4 presentation mentions url deduplication", () => {
    expect(read(SCRAPER_SKILL)).toMatch(/matched by URL or\s+company\+title/);
  });
});
