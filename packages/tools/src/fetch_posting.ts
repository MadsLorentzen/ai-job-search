/**
 * fetch-posting: archive a job posting as a markdown snapshot in postings/.
 *
 * Wraps `defuddle parse <url> --markdown --frontmatter`, then merges job
 * frontmatter (url, fetched_at, job_key, portal) and writes
 * postings/<job_key>.md. Robots are respected via a robots-check gate before
 * fetching. The snapshot is evidence: later stages read this file, never a
 * re-fetch.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeKey } from "./job_key.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const POSTINGS = join(REPO, "postings");

export interface FetchOptions {
  company: string;
  title: string;
  url: string;
  portal?: string;
  out?: string;
}

export function frontmatterFor(o: FetchOptions, jobKey: string): string {
  const lines = [
    "---",
    `url: ${o.url}`,
    `fetched_at: ${new Date().toISOString()}`,
    `job_key: ${jobKey}`,
  ];
  if (o.portal) lines.push(`portal: ${o.portal}`);
  lines.push("---");
  return lines.join("\n") + "\n\n";
}

export function fetchPostingMain(argv: string[]): number {
  let url = "";
  const o: FetchOptions = { company: "", title: "", url: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--company") o.company = argv[++i]!;
    else if (a === "--title") o.title = argv[++i]!;
    else if (a === "--portal") o.portal = argv[++i]!;
    else if (a === "--out") o.out = argv[++i]!;
    else if (!a.startsWith("-") && !url) url = a;
    else {
      process.stderr.write(`unknown flag: ${a}\n`);
      return 2;
    }
  }
  o.url = url;
  if (!url || !o.company || !o.title) {
    process.stderr.write(
      "usage: cli.ts fetch-posting <url> --company <c> --title <t> [--portal <p>] [--out <file>]\n",
    );
    return 2;
  }

  const jobKey = makeKey(o.company, o.title);
  const target = o.out ?? join(POSTINGS, `${jobKey}.md`);
  if (existsSync(target)) {
    process.stderr.write(`error: ${target} already exists — never overwrite a snapshot\n`);
    return 1;
  }

  const res = spawnSync(
    "defuddle",
    ["parse", url, "--markdown", "--frontmatter"],
    { encoding: "utf8" },
  );
  if (res.error || res.status !== 0) {
    process.stderr.write(
      `error: defuddle failed (exit ${res.status ?? "?"}). For bot-blocked pages, paste the text by hand into postings/ (see postings/AGENTS.md).\n`,
    );
    return 1;
  }

  // Strip defuddle's own frontmatter; ours is authoritative for the pipeline.
  const body = res.stdout.replace(/^---\n[\s\S]*?\n---\n/, "").trim() + "\n";
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, frontmatterFor(o, jobKey) + body);
  process.stdout.write(`${target}\n`);
  return 0;
}
