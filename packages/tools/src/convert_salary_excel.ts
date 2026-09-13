/**
 * Convert salary data from Excel to JSON format.
 *
 * Port of tools/convert_salary_excel.py. Reads .xlsx with a minimal pure-TS
 * reader (zip central-directory walk + inflateRaw + XML scraping) — no new
 * dependencies.
 *
 * Usage: bun run packages/tools/src/cli.ts convert-salary-excel <excel-file>
 *        [--output <path>] [--source <name>] [--baseline <n>]
 *        [--baseline-desc <text>]
 *
 * The output file (salary_data.json) defaults to the repository root.
 */

import { inflateRawSync } from "node:zlib";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Minimal xlsx reader: unzip + scrape the sheet/sharedStrings XML.
// ---------------------------------------------------------------------------

type Cell = string | number | boolean | null;

interface ZipEntry {
  name: string;
  data: Buffer;
}

function unzip(buffer: Buffer): ZipEntry[] {
  // Locate the End of Central Directory record (scan backwards: the comment
  // that may follow it is variable-length).
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip file (no end-of-central-directory record)");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    // Local file header: name/extra lengths differ from the central record.
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buffer.subarray(start, start + compressedSize);
    entries.push({
      name,
      data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw),
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    // Rich-text runs concatenate; plain <t> is the single-run case.
    let text = "";
    for (const t of si[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t[1]!;
    out.push(decodeEntities(text));
  }
  return out;
}

function columnIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheetXml(xml: string, shared: string[]): Cell[][] {
  const rows: Cell[][] = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: Cell[] = [];
    for (const c of rowMatch[1]!.matchAll(/<c([^>]*)\/>|<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = (c[1] ?? c[2] ?? "") + " ";
      const body = c[3] ?? "";
      const refMatch = /r="([A-Z]+[0-9]+)"/.exec(attrs);
      const col = refMatch ? columnIndex(refMatch[1]!) : cells.length;
      const type = /t="([a-zA-Z]+)"/.exec(attrs)?.[1];
      let value: Cell = null;
      if (type === "s") {
        const idx = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (idx !== undefined) value = shared[Number(idx)] ?? null;
      } else if (type === "inlineStr") {
        value = decodeEntities(/<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? "");
      } else if (type === "b") {
        value = /<v>1<\/v>/.test(body);
      } else if (type === "str") {
        value = decodeEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v !== undefined && v !== "") value = Number(v);
      }
      cells[col] = value ?? null;
    }
    rows.push(cells);
  }
  return rows;
}

export interface Worksheet {
  title: string;
  rows: Cell[][];
}

function readWorkbook(buffer: Buffer): Worksheet[] {
  const entries = unzip(buffer);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const sharedXml = byName.get("xl/sharedStrings.xml")?.data.toString("utf8") ?? "";
  const shared = sharedStrings(sharedXml);

  // Sheet order/names come from workbook.xml; the rels map maps r:id -> target.
  const relsXml = byName.get("xl/_rels/workbook.xml.rels")?.data.toString("utf8") ?? "";
  const rels = new Map<string, string>();
  for (const rel of relsXml.matchAll(/<Relationship[^>]*>/g)) {
    const tag = rel[0];
    const id = /Id="([^"]+)"/.exec(tag)?.[1];
    const target = /Target="([^"]+)"/.exec(tag)?.[1];
    if (id && target) rels.set(id, target.replace(/^\//, ""));
  }
  const workbookXml = byName.get("xl/workbook.xml")?.data.toString("utf8") ?? "";
  const sheets: Worksheet[] = [];
  for (const s of workbookXml.matchAll(/<sheet[^>]*>/g)) {
    const tag = s[0];
    const title = decodeEntities(/name="([^"]+)"/.exec(tag)?.[1] ?? "");
    const rid = /r:id="([^"]+)"/.exec(tag)?.[1];
    if (!rid) continue;
    let target = rels.get(rid) ?? "";
    if (!target) continue;
    if (!target.startsWith("xl/")) target = `xl/${target.replace(/^\.\.\//, "")}`;
    const sheetXml = byName.get(target)?.data.toString("utf8");
    if (!sheetXml) continue;
    sheets.push({ title, rows: parseSheetXml(sheetXml, shared) });
  }
  if (sheets.length === 0) throw new Error("no worksheets found in workbook");
  return sheets;
}

// ---------------------------------------------------------------------------
// Column-name pattern detection (ported verbatim).
// ---------------------------------------------------------------------------

export const COMPANY_PATTERNS = new Set(["firma", "company", "virksomhed", "employer", "arbejdsgiver"]);
export const CITY_PATTERNS = new Set(["by", "city", "kommune", "location", "lokation", "sted"]);
export const COUNT_PATTERNS = new Set(["antal", "count", "number", "n", "employees", "medarbejdere"]);
export const INDEX_PATTERNS = new Set([
  "indeks", "index", "idx", "salary", "løn", "median", "average", "gennemsnit",
]);
// "Compound" tokens: pattern words allowed to match as a substring of a larger
// header token, for languages that glue words together (e.g. Danish "lønindeks"
// -> løn + indeks).
export const COMPOUND_PATTERNS = new Set(["antal", "indeks", "løn", "gennemsnit", "medarbejdere"]);
// Identifier columns (employee id, Danish "personnummer", etc.) are never
// salary data.
export const ID_PATTERNS = new Set(["id", "personnummer"]);

export function parseNumericCell(value: Cell): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") throw new Error("not numeric");

  let text = value.trim().replace(" ", " ").replace(/ /g, "");
  if (!text) throw new Error("not numeric");
  if (text.includes(",") && text.includes(".")) {
    // The separator that appears last is the decimal separator: European
    // "1.234,56" and US "1,234.56" are both unambiguous here.
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.split(".").join("").replace(",", ".");
    } else {
      text = text.split(",").join("");
    }
  } else if (text.includes(",")) {
    if (/^[+-]?\d+,\d{3}$/.test(text)) throw new Error("ambiguous comma separator");
    text = text.replace(",", ".");
  } else if (text.includes(".")) {
    if (/^[+-]?\d+\.\d{3}$/.test(text)) throw new Error("ambiguous dot separator");
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error("not numeric");
  return parsed;
}

export function headerMatches(header: string, patterns: Set<string>): boolean {
  const h = header.toLowerCase().trim();
  const tokens = new Set(h.match(/[a-zæøåöäü0-9]+/g) ?? []);

  for (const p of patterns) {
    if (tokens.has(p)) return true;
    if (COMPOUND_PATTERNS.has(p) && h.includes(p)) return true;
  }
  return false;
}

export function stripTypePatterns(header: string, patterns: Set<string>): string {
  let name = header.toLowerCase();
  for (const p of patterns) {
    const letterClass = "[a-zæøåöäü0-9]";
    name = name.replace(
      new RegExp(`(?<!${letterClass})${escapeRegExp(p)}(?!${letterClass})`, "g"),
      "",
    );
    if (COMPOUND_PATTERNS.has(p)) name = name.split(p).join("");
  }
  return name.replace(/^[\s_-]+|[\s_-]+$/g, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectColumnType(header: string): "count" | "index" | null {
  if (headerMatches(header, COUNT_PATTERNS)) return "count";
  if (headerMatches(header, INDEX_PATTERNS)) return "index";
  return null;
}

export interface CompanyEntry {
  company: string;
  city: string;
  categories: Record<string, { count?: number | null; index?: number | string | null }>;
}

export function parseSheet(ws: Worksheet, _sheetLabel?: string): CompanyEntry[] {
  // Find header row. Two passes: strict (company-pattern cell corroborated by
  // a DIFFERENT city/count/index cell), then fallback (any company mention).
  const rows = ws.rows.slice(0, 10);

  const cellTexts = (row: Cell[]): string[] =>
    row.filter((v) => v !== null && v !== undefined).map((v) => String(v).trim());

  let headerRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const texts = cellTexts(rows[i]!);
    const hasCompany = texts.some((t) => headerMatches(t, COMPANY_PATTERNS));
    if (!hasCompany) continue;
    // Corroboration must come from a separate cell — a single free-text
    // sentence can pack both a company word and a count word.
    const hasOther = texts.some(
      (t) =>
        !headerMatches(t, COMPANY_PATTERNS) &&
        (headerMatches(t, CITY_PATTERNS) ||
          headerMatches(t, COUNT_PATTERNS) ||
          headerMatches(t, INDEX_PATTERNS)),
    );
    if (hasOther) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    for (let i = 0; i < rows.length; i++) {
      if (cellTexts(rows[i]!).some((t) => headerMatches(t, COMPANY_PATTERNS))) {
        headerRowIdx = i;
        break;
      }
    }
  }

  if (headerRowIdx === -1) {
    process.stderr.write(`Warning: Could not find header row in sheet '${ws.title}'. Skipping.\n`);
    return [];
  }

  const headers = (rows[headerRowIdx] ?? []).map((v) => (v == null ? "" : String(v).trim()));

  let companyCol: number | null = null;
  let cityCol: number | null = null;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]!;
    if (!h) continue;
    if (headerMatches(h, COMPANY_PATTERNS)) companyCol = i;
    else if (headerMatches(h, CITY_PATTERNS)) cityCol = i;
  }

  if (companyCol === null) {
    process.stderr.write(`Warning: Could not find company column in sheet '${ws.title}'.\n`);
    return [];
  }

  const dataCols: [number, string][] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]!;
    if (i === companyCol || i === cityCol || !h) continue;
    if (headerMatches(h, ID_PATTERNS)) continue;
    dataCols.push([i, h]);
  }

  const countCols: [number, string, string][] = [];
  const indexCols: [number, string, string][] = [];
  const untypedCols: [number, string][] = [];

  for (const [colIdx, colHeader] of dataCols) {
    const colType = detectColumnType(colHeader);
    if (colType === "count") {
      countCols.push([colIdx, colHeader, stripTypePatterns(colHeader, COUNT_PATTERNS)]);
    } else if (colType === "index") {
      indexCols.push([colIdx, colHeader, stripTypePatterns(colHeader, INDEX_PATTERNS)]);
    } else {
      untypedCols.push([colIdx, colHeader]);
    }
  }

  type Category =
    | { name: string; count_col: number; index_col: number }
    | { name: string; value_col: number; field?: "count" };
  const categories: Category[] = [];
  const usedCounts = new Set<number>();
  const usedIndexes = new Set<number>();

  for (let ci = 0; ci < countCols.length; ci++) {
    const [cIdx, , cCat] = countCols[ci]!;
    for (let ii = 0; ii < indexCols.length; ii++) {
      if (usedIndexes.has(ii)) continue;
      const [, , iCat] = indexCols[ii]!;
      if (cCat && iCat && cCat === iCat) {
        categories.push({
          name: cCat.split(" ").join("_").split("-").join("_"),
          count_col: cIdx,
          index_col: indexCols[ii]![0],
        });
        usedCounts.add(ci);
        usedIndexes.add(ii);
        break;
      }
    }
  }

  for (let ci = 0; ci < countCols.length; ci++) {
    if (!usedCounts.has(ci)) {
      const [cIdx, cHeader] = countCols[ci]!;
      categories.push({ name: cHeader.toLowerCase().split(" ").join("_"), value_col: cIdx, field: "count" });
    }
  }

  for (let ii = 0; ii < indexCols.length; ii++) {
    if (!usedIndexes.has(ii)) {
      const [iIdx, iHeader] = indexCols[ii]!;
      categories.push({ name: iHeader.toLowerCase().split(" ").join("_"), value_col: iIdx });
    }
  }

  for (const [colIdx, colHeader] of untypedCols) {
    categories.push({ name: colHeader.toLowerCase().split(" ").join("_"), value_col: colIdx });
  }

  if (categories.length === 0) {
    process.stderr.write(
      `Warning: No salary data columns detected in sheet '${ws.title}' ` +
        "(only a company/city column was found) - the header row may be " +
        "wrong, or this sheet has no salary data.\n",
    );
  }

  const companies: CompanyEntry[] = [];
  for (const row of ws.rows.slice(headerRowIdx + 1)) {
    if (!row) continue;
    if (companyCol >= row.length || !row[companyCol]) continue;

    const companyName = String(row[companyCol]).trim();
    const cityName =
      cityCol !== null && cityCol < row.length && row[cityCol] != null
        ? String(row[cityCol]).trim()
        : "";

    const entry: CompanyEntry = { company: companyName, city: cityName, categories: {} };

    for (const cat of categories) {
      const catName = cat.name;
      if ("count_col" in cat && "index_col" in cat) {
        let countVal: number | null = null;
        let indexVal: number | null = null;
        const cRaw = cat.count_col < row.length ? row[cat.count_col] : null;
        if (cRaw != null) {
          try {
            countVal = Math.trunc(parseNumericCell(cRaw));
          } catch {
            /* non-numeric */
          }
        }
        const iRaw = cat.index_col < row.length ? row[cat.index_col] : null;
        if (iRaw != null) {
          try {
            indexVal = parseNumericCell(iRaw);
          } catch {
            /* non-numeric */
          }
        }
        if (countVal === null && indexVal === null) continue;
        entry.categories[catName] = { count: countVal, index: indexVal };
      } else if ("value_col" in cat) {
        const raw = cat.value_col < row.length ? row[cat.value_col] : null;
        if (raw != null) {
          let val: number;
          try {
            val = parseNumericCell(raw);
          } catch {
            continue; // non-numeric standalone value (e.g. a free-text Notes column)
          }
          const field = cat.field ?? "index";
          entry.categories[catName] =
            field === "count" ? { count: Math.trunc(val) } : { index: val };
        }
      }
    }

    companies.push(entry);
  }

  return companies;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  process.stderr.write(
    "usage: convert-salary-excel <excel-file> [--output <path>] [--source <name>] " +
      "[--baseline <n>] [--baseline-desc <text>]\n",
  );
  process.exit(2);
}

export function convertSalaryExcelMain(argv: string[], root: string = ROOT): number {
  let excelFile = "";
  let output: string | null = null;
  let source: string | null = null;
  let baseline = 100;
  let baselineDesc: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--output") output = argv[++i] ?? usage();
    else if (a === "--source") source = argv[++i] ?? usage();
    else if (a === "--baseline") baseline = Number(argv[++i] ?? usage());
    else if (a === "--baseline-desc") baselineDesc = argv[++i] ?? usage();
    else if (a.startsWith("--")) usage();
    else if (excelFile === "") excelFile = a;
    else usage();
  }
  if (excelFile === "") usage();

  if (!existsSync(excelFile)) {
    process.stderr.write(`Error: File not found: ${excelFile}\n`);
    return 1;
  }

  const outputPath = output ?? join(root, "salary_data.json");

  console.log(`Reading: ${excelFile}`);
  let sheets: Worksheet[];
  try {
    sheets = readWorkbook(readFileSync(excelFile));
  } catch (exc) {
    process.stderr.write(`Error: could not read ${basename(excelFile)} as .xlsx: ${exc}\n`);
    return 1;
  }

  const allCompanies: CompanyEntry[] = [];
  for (const ws of sheets) {
    console.log(`  Parsing sheet: ${ws.title}`);
    allCompanies.push(...parseSheet(ws, ws.title));
  }

  if (allCompanies.length === 0) {
    process.stderr.write("Error: No data could be parsed from the Excel file.\n");
    process.stderr.write(
      "Make sure the Excel file has a header row with a 'Company'/'Firma' column.\n",
    );
    return 1;
  }

  const out = {
    metadata: {
      source: source ?? basename(excelFile).replace(/\.[^.]*$/, ""),
      index_baseline: baseline,
      index_label: "Index",
      baseline_description: baselineDesc ?? `Index ${baseline} = baseline`,
    },
    companies: allCompanies,
  };

  writeFileSync(outputPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\nDone! Wrote ${allCompanies.length} company entries to ${outputPath}`);
  return 0;
}
