/**
 * fetch-posting: archive a job posting as a markdown snapshot in postings/.
 *
 * Pipeline: defuddle (extract) -> knap (render the _templates/posting.md
 * record template). The snapshot is evidence: later stages read this file,
 * never a re-fetch.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { makeKey } from "./job_key.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const POSTINGS = join(REPO, "postings");
const TEMPLATE = join(REPO, "_templates/posting.md");

export interface FetchOptions {
  company: string;
  title: string;
  url: string;
  portal?: string;
  out?: string;
}

/** Run the defuddle→knap pipe. Returns rendered markdown or null on failure. */
export function renderPosting(
  o: FetchOptions,
  jobKey: string,
  deps: { defuddle?: typeof spawnSync; knap?: typeof spawnSync; template?: string } = {},
): string | null {
  const runDefuddle = deps.defuddle ?? spawnSync;
  const runKnap = deps.knap ?? spawnSync;
  const template = deps.template ?? TEMPLATE;
  const tmp = mkdtempSync(join(tmpdir(), "fetch-posting-"));
  try {
    const json = runDefuddle("defuddle", ["parse", o.url, "--json"], {
      encoding: "utf8",
    });
    if (json.status !== 0) return null;
    const dataFile = join(tmp, "data.json");
    writeFileSync(dataFile, json.stdout);

    const sets = [
      "--set",
      `job_key=${jobKey}`,
      "--set",
      `fetched_at=${new Date().toISOString()}`,
      "--set",
      `company=${o.company}`,
    ];
    if (o.portal) sets.push("--set", `portal=${o.portal}`);
    if (o.title) sets.push("--set", `title=${o.title}`);
    const rendered = runKnap("knap", ["render", template, "--data", dataFile, ...sets], {
      encoding: "utf8",
    });
    if (rendered.status !== 0) {
      process.stderr.write((rendered.stderr || "") + "\n");
      return null;
    }
    return rendered.stdout;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
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

  const markdown = renderPosting(o, jobKey);
  if (markdown === null) {
    process.stderr.write(
      `error: defuddle/knap failed. For bot-blocked pages, paste the text by hand into postings/ (see postings/AGENTS.md).\n`,
    );
    return 1;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, markdown);
  process.stdout.write(`${target}\n`);
  return 0;
}
