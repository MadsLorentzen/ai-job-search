/**
 * Triage upstream commits this fork has not picked up yet.
 *
 * Port of tools/upstream_triage.py. Emits a Markdown report that sorts the
 * behind-list into "worth reviewing" vs "probably skip". It never merges,
 * pushes, or edits anything - it only reads git history and prints.
 *
 * Usage: bun run packages/tools/src/cli.ts upstream-triage
 *        [--remote upstream] [--branch master] [--wontport <path>]
 * Exits 0 always (a report, not a gate); prints a note to stderr and exits 0
 * if the upstream ref is unavailable, so a scheduled job degrades gracefully.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;

function git(args: string[], cwd: string): string {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return res.stdout ?? "";
}

function gitOk(args: string[], cwd: string): boolean {
  return spawnSync("git", args, { cwd }).status === 0;
}

function revList(rangeSpec: string, cwd: string): string[] {
  const out = git(["rev-list", "--no-merges", rangeSpec], cwd).trim();
  return out ? out.split("\n") : [];
}

function patchId(sha: string, cwd: string): string | null {
  const show = spawnSync("git", ["show", sha], { cwd, encoding: "utf8" });
  if (show.status !== 0 || show.stdout == null) return null;
  const r = spawnSync("git", ["patch-id", "--stable"], {
    cwd,
    input: show.stdout,
    encoding: "utf8",
  });
  const line = (r.stdout ?? "").trim();
  return line ? line.split(/\s+/)[0]! : null;
}

function subject(sha: string, cwd: string): string {
  return git(["show", "-s", "--format=%s", sha], cwd).trim();
}

function filesTouched(sha: string, cwd: string): string[] {
  const out = git(["show", "--name-only", "--format=", sha], cwd).trim();
  return out.split("\n").filter((f) => f.length > 0);
}

function pathExists(path: string, cwd: string): boolean {
  // cat-file against HEAD is authoritative for "does this fork still ship it".
  return gitOk(["cat-file", "-e", `HEAD:${path}`], cwd);
}

function remoteSlug(remote: string, cwd: string): string | null {
  let url: string;
  try {
    url = git(["remote", "get-url", remote], cwd).trim();
  } catch {
    return null;
  }
  for (const sep of ["github.com/", "github.com:"]) {
    if (url.includes(sep)) {
      const path = url.split(sep)[1]!;
      return path.endsWith(".git") ? path.slice(0, -4) : path;
    }
  }
  return null;
}

function loadWontPort(path: string): string[] {
  if (!existsSync(path)) return [];
  const entries: string[] = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.split("#", 1)[0]!.trim();
    if (line) entries.push(line);
  }
  return entries;
}

function commitCell(short: string, sha: string, slug: string | null): string {
  if (slug) return `[\`${short}\`](https://github.com/${slug}/commit/${sha})`;
  return `\`${short}\``;
}

function printCrossref(ref: string): void {
  console.log();
  console.log(
    "_For personalized-file version stamps (which methodology files changed), " +
      `run \`bun run packages/tools/src/cli.ts upstream-updates --remote ${ref.split("/")[0]}\`._`,
  );
}

export function upstreamTriageMain(argv: string[], root: string = ROOT): number {
  let remote = "upstream";
  let branch = "master";
  let wontportPath = ".github/upstream-wontport.txt";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--remote") remote = argv[++i]!;
    else if (a === "--branch") branch = argv[++i]!;
    else if (a === "--wontport") wontportPath = argv[++i]!;
    else {
      process.stderr.write(`usage: upstream-triage [--remote <name>] [--branch <name>] [--wontport <path>]\n`);
      return 2;
    }
  }
  const ref = `${remote}/${branch}`;
  const slug = remoteSlug(remote, root);
  const wontport = loadWontPort(join(root, wontportPath));

  if (!gitOk(["rev-parse", "--verify", ref], root)) {
    process.stderr.write(
      `note: ${ref} not available (add the remote and fetch it first); nothing to triage.\n`,
    );
    console.log(`_Upstream ref \`${ref}\` was not available when this ran._`);
    return 0;
  }

  const behind = revList(`HEAD..${ref}`, root);
  if (behind.length === 0) {
    console.log(`Up to date with \`${ref}\`. Nothing to review. :white_check_mark:`);
    printCrossref(ref);
    return 0;
  }

  const forkOnly = revList(`${ref}..HEAD`, root);
  const forkPatchIds = new Set(forkOnly.map((s) => patchId(s, root)).filter(Boolean));
  const forkSubjects = new Set(forkOnly.map((s) => subject(s, root)));

  const review: [string, string, string, string[]][] = [];
  const skip: [string, string, string, string][] = [];

  for (const sha of behind) {
    const subj = subject(sha, root);
    const short = sha.slice(0, 9);
    if (forkPatchIds.has(patchId(sha, root) ?? "") || forkSubjects.has(subj)) {
      skip.push([short, sha, subj, "already applied (cherry-picked)"]);
      continue;
    }
    if (wontport.some((e) => sha.startsWith(e))) {
      skip.push([short, sha, subj, "on the fork's won't-port list"]);
      continue;
    }
    const touched = filesTouched(sha, root);
    const present = touched.filter((f) => pathExists(f, root));
    // A commit whose only surviving footprint is the changelog is one whose
    // real change lives in files this fork removed - the code doesn't apply,
    // only a doc line would. Low signal; demote it.
    const substantive = present.filter((f) => f !== "CHANGELOG.md");
    if (touched.length > 0 && present.length === 0) {
      skip.push([short, sha, subj, "touches only files not in this fork"]);
    } else if (present.length > 0 && substantive.length === 0) {
      skip.push([short, sha, subj, "changelog-only footprint in this fork"]);
    } else {
      review.push([short, sha, subj, substantive]);
    }
  }

  const lines: string[] = [];
  lines.push(
    `Upstream \`${ref}\` has **${behind.length}** commit(s) this fork lacks: ` +
      `**${review.length}** worth reviewing, **${skip.length}** probably skippable.`,
  );
  lines.push("");
  lines.push("_This is a triage report. Nothing was merged - review and port by hand._");
  lines.push("");

  lines.push("### Worth reviewing");
  if (review.length > 0) {
    lines.push("");
    lines.push("| Commit | Subject | Fork files it touches |");
    lines.push("|---|---|---|");
    for (const [short, sha, subj, present] of review) {
      let shown =
        present.slice(0, 4).map((p) => `\`${p}\``).join(", ") || "_(new/shared paths)_";
      if (present.length > 4) shown += ` +${present.length - 4} more`;
      lines.push(`| ${commitCell(short, sha, slug)} | ${subj} | ${shown} |`);
    }
    // Ready-to-run cherry-pick lines - still information, not action. The
    // report stops here on purpose; a human runs (and verifies) these.
    lines.push("");
    lines.push("<details><summary>Ready-to-run cherry-picks (review each before running)</summary>");
    lines.push("");
    lines.push("```bash");
    for (const [, sha, subj] of review) {
      lines.push(`git cherry-pick ${sha}  # ${subj}`);
    }
    lines.push("```");
    lines.push("");
    lines.push("</details>");
  } else {
    lines.push("");
    lines.push("_None._");
  }
  lines.push("");

  lines.push("### Probably skip");
  if (skip.length > 0) {
    lines.push("");
    lines.push("| Commit | Subject | Why |");
    lines.push("|---|---|---|");
    for (const [short, sha, subj, why] of skip) {
      lines.push(`| ${commitCell(short, sha, slug)} | ${subj} | ${why} |`);
    }
  } else {
    lines.push("");
    lines.push("_None._");
  }

  console.log(lines.join("\n"));
  printCrossref(ref);
  return 0;
}
