/** Tests for lint_skills — adapted to the .pi-agent layout (no .claude tree). */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintSkillsMain } from "../src/lint_skills.ts";

const tmpRoots: string[] = [];
afterAll(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});

function makeFixture(): { root: string; settings: string; skill: string } {
  const root = mkdtempSync(join(tmpdir(), "lint-skills-"));
  tmpRoots.push(root);

  const skillDir = join(root, ".pi-agent", "skills", "example");
  mkdirSync(skillDir, { recursive: true });
  const skill = join(skillDir, "SKILL.md");
  writeFileSync(skill, "---\nname: example\ndescription: Example skill\n---\n", "utf8");

  const settings = join(root, ".pi-agent", "settings.json");
  mkdirSync(join(root, ".pi-agent"), { recursive: true });
  writeFileSync(settings, JSON.stringify({ permissions: { allow: [] } }), "utf8");

  return { root, settings, skill };
}

function run(root: string): { code: number; out: string } {
  // Capture console.log without leaking into the test output.
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  let code: number;
  try {
    code = lintSkillsMain([], root);
  } finally {
    console.log = original;
  }
  return { code, out: lines.join("\n") };
}

describe("settings shape", () => {
  test("valid settings pass", () => {
    const { root } = makeFixture();
    const result = run(root);
    expect(result.code).toBe(0);
    expect(result.out).toContain("lint_skills: OK");
  });

  test("invalid JSON fails cleanly", () => {
    const { root, settings } = makeFixture();
    writeFileSync(settings, "{not json", "utf8");
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.out).toContain(".pi-agent/settings.json");
  });

  test("non-object root fails cleanly", () => {
    for (const data of [[], "settings", 1, null]) {
      const { root, settings } = makeFixture();
      writeFileSync(settings, JSON.stringify(data), "utf8");
      const result = run(root);
      expect(result.code).toBe(1);
      expect(result.out).toContain("top-level JSON value to be an object");
    }
  });
});

describe("skill checks", () => {
  function writeSkill(root: string, frontmatter: string): void {
    writeFileSync(
      join(root, ".pi-agent", "skills", "example", "SKILL.md"),
      frontmatter,
      "utf8",
    );
  }

  test("allowed-tools referencing a missing file fails", () => {
    const { root } = makeFixture();
    writeSkill(
      root,
      "---\n" +
        "name: example\n" +
        "description: Example skill\n" +
        "allowed-tools: Bash(bun run .pi-agent/skills/example/DOES_NOT_EXIST.ts *)\n" +
        "---\n",
    );
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.out).toContain("allowed-tools references a missing file");
    expect(result.out).toContain("DOES_NOT_EXIST.ts");
  });

  test("allowed-tools referencing an existing file passes", () => {
    const { root } = makeFixture();
    writeFileSync(
      join(root, ".pi-agent", "skills", "example", "cli.ts"),
      "// present\n",
      "utf8",
    );
    writeSkill(
      root,
      "---\n" +
        "name: example\n" +
        "description: Example skill\n" +
        "allowed-tools: Bash(bun run .pi-agent/skills/example/cli.ts *)\n" +
        "---\n",
    );
    const result = run(root);
    expect(result.code).toBe(0);
  });

  test("frontmatter missing description fails", () => {
    const { root } = makeFixture();
    writeSkill(root, "---\nname: example\ndescription:\n---\n");
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.out).toContain("missing required key 'description'");
  });

  test("missing frontmatter fails", () => {
    const { root } = makeFixture();
    writeSkill(root, "# just markdown\n");
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.out).toContain("missing YAML frontmatter");
  });
});
