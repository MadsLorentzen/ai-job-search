/**
 * Salary Benchmark Lookup Tool
 *
 * Port of salary_lookup.py. Looks up company salary data from a
 * user-provided dataset (salary_data.json at the repo root — same data file
 * and path the python tool used).
 *
 * Usage: bun run packages/tools/src/cli.ts salary-lookup "Company Name"
 *        [--city "København"] [--json] | --list-all | --validate
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;
const README_REF = "tools/README_SALARY_TOOL.md";

type CategoryData = { count?: number | null; index?: number | string | null };
export interface CompanyEntry {
  company: string;
  city?: string | null;
  categories?: Record<string, CategoryData> | null;
  [key: string]: unknown;
}
export interface SalaryData {
  metadata?: Record<string, unknown> | null;
  companies: CompanyEntry[];
}

// Common Danish <-> anglicized spelling variants
const SPELLING_VARIANTS: Record<string, string> = {
  ø: "o", æ: "ae", å: "aa", ö: "o", ä: "ae", ü: "u",
};

// Legal suffixes and noise to strip when matching company names
const STRIP_PATTERNS = [
  String.raw`\ba/s\b`, String.raw`\baps\b`, String.raw`\bi/s\b`, String.raw`\bp/s\b`, String.raw`\bk/s\b`,
  String.raw`\bivs\b`, String.raw`\bamba\b`, String.raw`\ba\.m\.b\.a\.?\b`,
  String.raw`\(vg\)`, String.raw`\(.*?\)`, // (VG) and other parentheticals
  String.raw`\bdanmark\b`, String.raw`\bdenmark\b`, String.raw`\bscandinavia\b`, String.raw`\bnordic\b`,
  String.raw`\bgroup\b`, String.raw`\bholding\b`,
  String.raw`,\s*.*$`, // everything after comma (sub-entities)
];

export function normalize(s: string): string {
  s = s.toLowerCase().trim();
  for (const pat of STRIP_PATTERNS) s = s.replace(new RegExp(pat, "g"), "");
  return s.replace(/[^a-zæøåöäü0-9]/g, "");
}

export function anglicize(s: string): string {
  s = s.toLowerCase();
  for (const [danish, english] of Object.entries(SPELLING_VARIANTS)) {
    s = s.split(danish).join(english);
  }
  return s;
}

export function extractCoreWords(s: string): string[] {
  s = s.toLowerCase();
  for (const pat of STRIP_PATTERNS) s = s.replace(new RegExp(pat, "g"), "");
  const words = s.match(/[a-zæøåöäü0-9]+/g) ?? [];
  return words.filter((w) => w.length > 1);
}

export function matchScoreOptimized(
  qNorm: string,
  qAng: string,
  qWordsSet: Set<string>,
  qWordsAngSet: Set<string>,
  query: string,
  entryName: string,
): number {
  const nNorm = normalize(entryName);

  if (!qNorm || !nNorm) return 0;

  if (qNorm === nNorm) return 100;

  if (nNorm.includes(qNorm)) {
    const ratio = qNorm.length / nNorm.length;
    if (qNorm.length <= 4 && ratio < 0.5) {
      const nWords = new Set(extractCoreWords(entryName));
      const overlap = [...qWordsSet].some((w) => nWords.has(w));
      if (overlap) return 80 + Math.trunc(ratio * 10);
    } else {
      return 80 + Math.trunc(ratio * 10);
    }
  }
  if (qNorm.includes(nNorm)) {
    const ratio = nNorm.length / qNorm.length;
    if (nNorm.length <= 4 && ratio < 0.5) {
      // pass
    } else {
      return 80 + Math.trunc(ratio * 10);
    }
  }

  const nAng = anglicize(nNorm);
  if (qAng === nAng) return 85;
  if (qAng.includes(nAng) || nAng.includes(qAng)) {
    const shorter = Math.min(qAng.length, nAng.length);
    const longer = Math.max(qAng.length, nAng.length);
    if (shorter <= 4 && shorter / longer < 0.5) {
      const nWordsAng = new Set(extractCoreWords(entryName).map(anglicize));
      if ([...qWordsAngSet].some((w) => nWordsAng.has(w))) return 75;
    } else {
      return 75;
    }
  }

  const nWords = new Set(extractCoreWords(entryName));
  if (qWordsSet.size === 0 || nWords.size === 0) return 0;

  let overlap = [...qWordsSet].filter((w) => nWords.has(w));
  if (overlap.length === 0) {
    const nWordsAng = new Set([...nWords].map(anglicize));
    overlap = [...qWordsAngSet].filter((w) => nWordsAng.has(w));
  }

  if (overlap.length > 0) {
    if (qWordsSet.size === 1) {
      const qWord = [...qWordsSet][0]!;
      if (nWords.has(qWord) || [...nWords].map(anglicize).includes(anglicize(qWord))) {
        return 70;
      }
      return 0;
    }

    const coverage = overlap.length / qWordsSet.size;
    return Math.trunc(30 + coverage * 40);
  }

  return 0;
}

export function matchScore(query: string, entryName: string): number {
  const qNorm = normalize(query);
  const qAng = anglicize(qNorm);
  const qWords = extractCoreWords(query);
  return matchScoreOptimized(
    qNorm,
    qAng,
    new Set(qWords),
    new Set(qWords.map(anglicize)),
    query,
    entryName,
  );
}

export function searchCompany(
  data: SalaryData,
  query: string,
  city?: string,
): CompanyEntry[] {
  const companies = data.companies ?? [];

  const qNorm = normalize(query);
  const qAng = anglicize(qNorm);
  const qWords = extractCoreWords(query);
  const qWordsSet = new Set(qWords);
  const qWordsAngSet = new Set(qWords.map(anglicize));

  const scored: [number, CompanyEntry][] = [];
  for (const entry of companies) {
    if (city) {
      const cityLower = city.toLowerCase();
      const entryCity = (entry.city ?? "").toLowerCase();
      if (
        !entryCity.includes(cityLower) &&
        !anglicize(entryCity).includes(anglicize(cityLower))
      ) {
        continue;
      }
    }

    const score = matchScoreOptimized(
      qNorm, qAng, qWordsSet, qWordsAngSet, query, entry.company,
    );
    if (score > 0) scored.push([score, entry]);
  }

  scored.sort((a, b) => (a[0] === b[0] ? a[1].company.localeCompare(b[1].company) : b[0] - a[0]));

  const minScore = 30;
  return scored.filter(([score]) => score >= minScore).map(([, entry]) => entry);
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

export function formatEntry(entry: CompanyEntry, metadata: Record<string, unknown> | null | undefined): string {
  metadata = metadata ?? {};
  const lines: string[] = [];
  lines.push(`\n${"=".repeat(60)}`);
  lines.push(`  ${entry.company}`);
  if (entry.city) lines.push(`  Location: ${entry.city}`);
  lines.push(`${"=".repeat(60)}`);

  // Get category data (everything except company/city fields).
  let categories = entry.categories ?? {};
  const skipKeys = new Set(["company", "city", "categories"]);
  if (!categories || Object.keys(categories).length === 0) {
    // Fallback: treat any numeric fields as categories
    categories = {};
    for (const [key, value] of Object.entries(entry)) {
      if (!skipKeys.has(key) && typeof value === "object" && value !== null) {
        categories[key] = value as CategoryData;
      }
    }
  }

  const catKeys = Object.keys(categories);
  if (categories && catKeys.length > 0) {
    const indexLabel = (metadata["index_label"] as string) ?? "Index";
    const baseline = (metadata["index_baseline"] as number) ?? 100;

    lines.push(`  ${"Category".padEnd(22)} ${"Count".padStart(6)} ${indexLabel.padStart(8)}  ${"vs Baseline".padStart(10)}`);
    lines.push(`  ${"-".repeat(50)}`);

    for (const [label, data] of Object.entries(categories)) {
      const displayLabel = label.split("_").join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
      const count = data?.count;
      const index = data?.index;
      if (count !== null && count !== undefined) {
        const countStr = String(count);
        let indexStr: string;
        let diffStr: string;
        if (typeof index === "number") {
          indexStr = fmtNum(index);
          if (baseline === 0) {
            diffStr = "";
          } else {
            const diffPct = ((index - baseline) / baseline) * 100;
            const sign = diffPct >= 0 ? "+" : "";
            diffStr = `${sign}${diffPct.toFixed(1)}%`;
          }
        } else if (index !== null && index !== undefined) {
          indexStr = String(index);
          diffStr = "";
        } else {
          indexStr = "N/A*";
          diffStr = "";
        }
        lines.push(
          `  ${displayLabel.padEnd(22)} ${countStr.padStart(6)} ${indexStr.padStart(8)}  ${diffStr.padStart(10)}`,
        );
      } else if (index !== null && index !== undefined) {
        let indexStr: string;
        let diffStr: string;
        if (typeof index === "number") {
          indexStr = fmtNum(index);
          if (baseline === 0) {
            diffStr = "";
          } else {
            const diffPct = ((index - baseline) / baseline) * 100;
            const sign = diffPct >= 0 ? "+" : "";
            diffStr = `${sign}${diffPct.toFixed(1)}%`;
          }
        } else {
          indexStr = String(index);
          diffStr = "";
        }
        lines.push(
          `  ${displayLabel.padEnd(22)} ${"-".padStart(6)} ${indexStr.padStart(8)}  ${diffStr.padStart(10)}`,
        );
      }
    }

    lines.push(`\n  * N/A = Too few employees to publish (privacy)`);
    if (metadata["baseline_description"]) {
      lines.push(`  ${metadata["baseline_description"]}`);
    } else {
      lines.push(`  ${indexLabel} ${baseline} = baseline`);
    }
  } else {
    // Simple format: just show all non-standard fields
    const skipKeys = new Set(["company", "city", "categories"]);
    for (const [key, value] of Object.entries(entry)) {
      if (!skipKeys.has(key)) {
        const displayKey = key.split("_").join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
        lines.push(`  ${displayKey}: ${value}`);
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function typeName(v: unknown): string {
  if (v === null) return "NoneType";
  if (Array.isArray(v)) return "list";
  if (typeof v === "object") return "dict";
  return typeof v === "number" ? "number" : typeof v;
}

export function collectValidationIssues(data: unknown): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push("top-level JSON value must be an object");
    return { errors, warnings };
  }
  const obj = data as Record<string, unknown>;

  const metadata = obj["metadata"];
  if (metadata !== undefined && metadata !== null) {
    if (typeof metadata !== "object" || Array.isArray(metadata)) {
      errors.push("'metadata' must be an object when provided");
    }
  }

  const companies = obj["companies"];
  if (!Array.isArray(companies)) {
    errors.push("'companies' must be a list");
    return { errors, warnings };
  }

  const seenCompanies = new Map<string, number>();
  for (let i = 0; i < companies.length; i++) {
    const index = i + 1;
    const entry = companies[i]!;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      errors.push(`companies[${index}] must be an object`);
      continue;
    }
    const e = entry as Record<string, unknown>;

    const company = e["company"];
    if (typeof company !== "string" || company.trim() === "") {
      errors.push(`companies[${index}].company must be a non-empty string`);
    } else {
      const key = company.toLowerCase();
      if (seenCompanies.has(key)) {
        warnings.push(
          `Duplicate company name '${company}' (companies[${seenCompanies.get(key)}] and companies[${index}])`,
        );
      } else {
        seenCompanies.set(key, index);
      }
    }

    const city = e["city"];
    if (city !== undefined && city !== null && typeof city !== "string") {
      errors.push(`companies[${index}].city must be a string when provided`);
    }

    const categories = e["categories"];
    if (categories !== undefined && categories !== null) {
      if (typeof categories !== "object" || Array.isArray(categories)) {
        errors.push(`companies[${index}].categories must be an object when provided`);
      } else {
        for (const [catLabel, catData] of Object.entries(categories)) {
          if (typeof catData !== "object" || catData === null || Array.isArray(catData)) {
            errors.push(
              `companies[${index}].categories.${catLabel} must be an object with 'count' and/or 'index' (got ${typeName(catData)})`,
            );
            continue;
          }
          const cd = catData as Record<string, unknown>;
          const count = cd["count"];
          if (count !== undefined && count !== null && typeof count !== "number") {
            errors.push(
              `companies[${index}].categories.${catLabel}.count must be a number (got ${typeName(count)})`,
            );
          }
          const indexVal = cd["index"];
          if (
            indexVal !== undefined &&
            indexVal !== null &&
            typeof indexVal !== "number" &&
            typeof indexVal !== "string"
          ) {
            errors.push(
              `companies[${index}].categories.${catLabel}.index must be a number or string (got ${typeName(indexVal)})`,
            );
          }
        }
      }
    }
  }

  return { errors, warnings };
}

export function printValidationReport(errors: string[], warnings: string[]): number {
  if (errors.length === 0 && warnings.length === 0) {
    console.log("OK - no issues found.");
    return 0;
  }
  console.log(`Found ${errors.length + warnings.length} issue(s):`);
  if (errors.length > 0) {
    console.log("  Errors:");
    errors.forEach((msg, i) => console.log(`    [${i + 1}] ${msg}`));
  }
  if (warnings.length > 0) {
    console.log("  Warnings:");
    warnings.forEach((msg, i) => console.log(`    [${i + 1}] ${msg}`));
  }
  if (errors.length > 0) {
    console.log("");
    console.log(`Fix the errors above, then re-run. See ${README_REF} for the expected format.`);
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

export function readRawData(dataFile: string): unknown {
  if (!existsSync(dataFile)) {
    process.stderr.write("Error: salary_data.json not found.\n\n");
    process.stderr.write("This tool requires a salary data file.\n");
    process.stderr.write(`See ${README_REF} for setup instructions.\n\n`);
    process.stderr.write("If you don't have salary data, the salary lookup\n");
    process.stderr.write("step will be skipped during /apply.\n");
    process.exitCode = 1;
    throw new DataFileError();
  }
  let text: string;
  try {
    text = readFileSync(dataFile, "utf8");
  } catch (exc) {
    process.exitCode = 1;
    throw new DataFileError(String(exc));
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (exc) {
    // Bun's JSON.parse reports no position; for EOF-truncated input (the
    // common hand-edit failure) the error sits at end of input.
    let line = 1;
    let col = 1;
    const msg = String(exc);
    const m = /position (\d+)/.exec(msg);
    if (m) {
      const upto = text.slice(0, Number(m[1]));
      line = upto.split("\n").length;
      col = (upto.split("\n").pop() ?? "").length + 1;
    } else if (/EOF|end of (input|data)/i.test(msg)) {
      const lines = text.split("\n");
      line = lines.length;
      col = (lines[lines.length - 1] ?? "").length + 1;
    }
    process.stderr.write(
      `Error: invalid salary_data.json: invalid JSON at line ${line}, column ${col}: ${msg}\n\n`,
    );
    process.stderr.write(`See ${README_REF} for the expected format.\n`);
    process.exitCode = 1;
    throw new DataFileError();
  }
  return data;
}

export class DataFileError extends Error {}

export function validateData(data: unknown): SalaryData {
  const { errors } = collectValidationIssues(data);
  if (errors.length > 0) {
    process.stderr.write(`Error: invalid salary_data.json: ${errors[0]}\n\n`);
    process.stderr.write(`See ${README_REF} for the expected format.\n`);
    process.exitCode = 1;
    throw new DataFileError(errors[0]);
  }
  return data as SalaryData;
}

export function loadData(dataFile: string): SalaryData {
  return validateData(readRawData(dataFile));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`Salary Benchmark Lookup

usage: cli.ts salary-lookup "Company Name" [--city <city>] [--json]
       cli.ts salary-lookup --list-all
       cli.ts salary-lookup --validate`);
}

export function salaryLookupMain(
  argv: string[],
  root: string = ROOT,
  dataFileOverride?: string,
): number {
  let company: string | null = null;
  let city: string | undefined;
  let asJson = false;
  let listAll = false;
  let validate = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--city") city = argv[++i];
    else if (a === "--json") asJson = true;
    else if (a === "--list-all") listAll = true;
    else if (a === "--validate") validate = true;
    else if (a.startsWith("--")) {
      process.stderr.write(`unknown option: ${a}\n`);
      return 2;
    } else if (company === null) company = a;
    else {
      process.stderr.write("usage: salary-lookup <company> [options]\n");
      return 2;
    }
  }

  const dataFile = dataFileOverride ?? join(root, "salary_data.json");

  if (validate) {
    let data: unknown;
    try {
      data = readRawData(dataFile);
    } catch {
      return 1;
    }
    const { errors, warnings } = collectValidationIssues(data);
    console.log(`Validating ${dataFile.split("/").pop()} ...`);
    console.log("");
    return printValidationReport(errors, warnings);
  }

  let data: SalaryData;
  try {
    data = loadData(dataFile);
  } catch {
    return 1;
  }
  const metadata = data.metadata ?? {};
  const companies = data.companies ?? [];

  if (listAll) {
    for (const entry of companies) {
      const c = entry.city ?? "";
      const cityStr = c ? ` (${c})` : "";
      console.log(`${entry.company}${cityStr}`);
    }
    return 0;
  }

  if (!company) {
    printHelp();
    return 1;
  }

  const results = searchCompany(data, company, city);

  if (results.length === 0) {
    console.log(`No results found for '${company}'`);
    if (city) console.log(`  (filtered by city: ${city})`);
    console.log("\nTry a shorter or different name. Company names in the dataset");
    console.log("may include legal suffixes like 'A/S' or 'ApS'.");
    return 1;
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`\nFound ${results.length} match(es) for '${company}':`);
    for (const entry of results) {
      console.log(formatEntry(entry, metadata));
    }
    console.log();
  }
  return 0;
}
