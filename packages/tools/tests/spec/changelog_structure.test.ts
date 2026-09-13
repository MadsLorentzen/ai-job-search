/** Structural guard for CHANGELOG.md's [Unreleased] section. Port of
 * tests/test_changelog_structure.py. */
import { describe, expect, test } from "bun:test";
import { REPO, read } from "./helpers.ts";

const CHANGELOG = `${REPO}/CHANGELOG.md`;

const KNOWN_HEADINGS = new Set(["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"]);
const CONFLICT_MARKERS = ["<<<<<<< ", "=======", ">>>>>>> "];

function unreleasedBlock(text: string): string {
  const start = text.indexOf("## [Unreleased]");
  if (start === -1) return "";
  const end = text.indexOf("\n## [", start + 1);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

export function unreleasedProblems(text: string): string[] {
  const problems: string[] = [];
  const seen: string[] = [];
  let current: string | null = null;
  for (const [i, line] of unreleasedBlock(text).split("\n").entries()) {
    const lineno = i + 1;
    if (CONFLICT_MARKERS.some((m) => line.startsWith(m))) {
      problems.push(`conflict marker on [Unreleased] line ${lineno}: ${line.trim()}`);
      continue;
    }
    if (line.startsWith("### ")) {
      const name = line.slice(4).trim();
      if (!KNOWN_HEADINGS.has(name)) {
        problems.push(
          `unknown heading '### ${name}' in [Unreleased]; use one of ${[...KNOWN_HEADINGS].sort()}`,
        );
      }
      if (seen.includes(name)) {
        problems.push(`'### ${name}' appears twice in [Unreleased] - fold the entry into the existing section`);
      }
      seen.push(name);
      current = name;
    } else if (line.startsWith("- ") && current === null) {
      problems.push(`entry above any '###' heading in [Unreleased]: ${line.trim().slice(0, 70)}`);
    }
  }
  return problems;
}

const CLEAN = `# Changelog

## [Unreleased]

### Added

- **A new thing** - described.

### Fixed

- **A fixed thing** - described.

## [1.0.0] - 2026-01-01

### Fixed

- old entry
`;

describe("unreleasedProblems", () => {
  test("clean section reports nothing", () => {
    expect(unreleasedProblems(CLEAN)).toEqual([]);
  });

  test("duplicate heading is reported", () => {
    const text = CLEAN.replace(
      "## [Unreleased]\n\n### Added",
      "## [Unreleased]\n\n### Fixed\n\n- **Entry in the wrong place** - described.\n\n### Added",
    );
    const problems = unreleasedProblems(text);
    expect(problems.some((p) => p.includes("Fixed") && p.includes("twice"))).toBe(true);
  });

  test("unknown heading is reported", () => {
    const problems = unreleasedProblems(CLEAN.replace("### Fixed", "### Fixes"));
    expect(problems.some((p) => p.includes("Fixes"))).toBe(true);
  });

  test("entry above any heading is reported", () => {
    const text = CLEAN.replace(
      "## [Unreleased]\n\n### Added",
      "## [Unreleased]\n\n- **Orphan entry** - no heading above it.\n\n### Added",
    );
    const problems = unreleasedProblems(text);
    expect(problems.some((p) => p.includes("Orphan entry"))).toBe(true);
  });

  test("conflict markers are reported", () => {
    const problems = unreleasedProblems(CLEAN.replace("### Fixed", "<<<<<<< HEAD\n### Fixed"));
    expect(problems.some((p) => p.includes("conflict marker"))).toBe(true);
  });

  test("missing unreleased section is not a defect", () => {
    const text = "# Changelog\n\n## [1.7.1] - 2026-09-06\n\n### Fixed\n\n- **A fixed thing** - described.\n";
    expect(unreleasedProblems(text)).toEqual([]);
  });

  test("released sections are not inspected", () => {
    expect(unreleasedProblems(CLEAN + "\n### Fixed\n\n- another old entry\n")).toEqual([]);
  });
});

describe("real changelog", () => {
  test("unreleased section is well formed", () => {
    expect(unreleasedProblems(read(CHANGELOG))).toEqual([]);
  });
});
