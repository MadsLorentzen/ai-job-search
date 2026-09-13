/** Guards for /reset's two scopes. Port of tests/test_reset_command.py
 * (paths: profile/workflows, .pi-agent/skills). */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { REPO, WORKFLOWS, SKILLS, read, sliceBetween } from "./helpers.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

const RESET = `${WORKFLOWS}/reset.md`;
const SETUP = `${WORKFLOWS}/setup.md`;

function trackedDocumentSubfolders(): Set<string> {
  const out = spawnSync("git", ["ls-files", "documents/"], {
    cwd: REPO,
    encoding: "utf8",
  }).stdout ?? "";
  const folders = new Set<string>();
  for (const line of out.split("\n")) {
    const parts = line.split("/");
    if (parts.length >= 3) folders.add(parts[1]!); // documents/<subfolder>/<file>
  }
  return folders;
}

describe("/reset covers every documents subfolder", () => {
  test("preview lists every subfolder", () => {
    const folders = trackedDocumentSubfolders();
    expect(folders.size).toBeGreaterThanOrEqual(5);
    const text = read(RESET);
    const missing = [...folders].sort().filter((f) => !text.includes(`documents/${f}/`));
    expect(missing).toEqual([]);
  });

  test("delete block removes every subfolder", () => {
    const folders = trackedDocumentSubfolders();
    const text = read(RESET);
    const deleted = new Set([...text.matchAll(/rm -r?f documents\/(\w+)\//g)].map((m) => m[1]!));
    const missing = [...folders].filter((f) => !deleted.has(f)).sort();
    expect(missing).toEqual([]);
  });
});

function setupStep3SkillFiles(): Set<string> {
  const step3 = sliceBetween(read(SETUP), "## Step 3:", "## Step 4:");
  const files = new Set<string>();
  for (const m of step3.matchAll(/^###\s+\d+\.\s+\w+\s+`([^`]+)`/gm)) {
    const target = m[1]!;
    if (existsSync(join(REPO, target))) {
      if (target.startsWith(".pi-agent/skills/")) files.add(target.split("/").pop()!);
      continue;
    }
    // bare filename resolved against .pi-agent/skills/*/
    const res = spawnSync("git", ["ls-files", ".pi-agent/skills"], {
      cwd: REPO,
      encoding: "utf8",
    }).stdout;
    if (res?.split("\n").some((l) => l.endsWith(`/${target}`))) {
      files.add(target);
    }
  }
  return files;
}

describe("/reset covers every personalized skill file", () => {
  const files = setupStep3SkillFiles();

  test("setup still names the expected targets (sanity)", () => {
    expect(files.size).toBeGreaterThanOrEqual(6);
    expect(files.has("04-job-evaluation.md")).toBe(true);
    expect(files.has("search-queries.md")).toBe(true);
  });

  test("preview lists every personalized skill file", () => {
    const preview = sliceBetween(
      read(RESET),
      "### If scope includes `profile`:",
      "### If scope includes `documents`:",
    );
    const missing = [...files].filter((f) => !preview.includes(f)).sort();
    expect(missing).toEqual([]);
  });

  test("execution clears every personalized skill file", () => {
    const execution = sliceBetween(read(RESET), "### Profile reset", "### Documents reset");
    const missing = [...files].filter((f) => !execution.includes(f)).sort();
    expect(missing).toEqual([]);
  });

  test("preserved list claims no personalized file is framework-only", () => {
    const preserved = sliceBetween(read(RESET), "The following files are NOT touched", "```");
    const mislabeled = [...files].filter((f) => preserved.includes(f)).sort();
    expect(mislabeled).toEqual([]);
  });
});
