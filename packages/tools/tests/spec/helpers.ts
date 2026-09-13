/** Shared helpers for the spec-text suites (assertions on markdown specs). */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REPO = new URL("../../../..", import.meta.url).pathname;

export const WORKFLOWS = join(REPO, "profile", "workflows");
export const SKILLS = join(REPO, ".pi-agent", "skills");

export function read(...parts: string[]): string {
  return readFileSync(join(...parts), "utf8");
}

/** The body of one markdown section, up to the next heading of any depth. */
export function section(path: string, heading: string): string {
  const text = read(path);
  const start = text.indexOf(heading) + heading.length;
  const rest = text.slice(start);
  const end = /^#{1,4} /m.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

/** Split a spec into {heading: body} by "\n<marker> " heading prefixes. */
export function sections(text: string, marker = "##"): Record<string, string> {
  const parts = text.split(`\n${marker} `);
  const result: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const nl = part.indexOf("\n");
    const heading = nl === -1 ? part : part.slice(0, nl);
    result[heading.trim()] = nl === -1 ? "" : part.slice(nl + 1);
  }
  return result;
}

/** The slice of text from the start marker up to the end marker. */
export function sliceBetween(text: string, start: string, end: string): string {
  const begin = text.indexOf(start);
  if (begin === -1) throw new Error(`marker not found: ${start}`);
  const endIndex = text.indexOf(end, begin);
  if (endIndex === -1) throw new Error(`end marker not found: ${end}`);
  return text.slice(begin, endIndex);
}

/** Body of a markdown section up to the next heading of the same level. */
export function headingSection(text: string, heading: string): string {
  const level = heading.split(" ")[0]!;
  const pattern = new RegExp(
    `^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n([\\s\\S]*?)(?=(?:^${level} )|(?![\\s\\S]))`,
    "m",
  );
  const match = pattern.exec(text);
  return match ? match[1]! : "";
}
