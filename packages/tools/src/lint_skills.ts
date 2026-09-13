/**
 * Lint the repo's skill and settings files.
 *
 * Port of tools/lint_skills.py. Path adaptation for the pi-agent layout:
 * skills live under .pi-agent/skills/ only (the .claude/skills and
 * .claude/commands trees no longer exist), and the settings file is
 * .pi-agent/settings.json, whose schema has no permissions.allow list,
 * so only JSON validity and object shape are checked.
 *
 * Exit code 0 on success, 1 with a failure list otherwise.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;

export interface LintContext {
  root: string;
  errors: string[];
}

function rel(ctx: LintContext, path: string): string {
  return path.startsWith(ctx.root) ? path.slice(ctx.root.length).replace(/^\//, "") : path;
}

/** Flat "key: value" frontmatter parser (the shape every SKILL.md uses). */
export function parseFrontmatter(text: string): Record<string, string> | null {
  const data: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    data[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return data;
}

function globHasMatches(ctx: LintContext, base: string, pattern: string): boolean {
  // Only the subset of glob syntax the allowed-tools entries use: literal
  // path segments plus single '*' wildcards (Bun.Glob accepts full patterns).
  for (const entry of new Bun.Glob(pattern).scanSync({ cwd: base, onlyFiles: true })) return true;
  return false;
}

export function checkSkill(ctx: LintContext, path: string): void {
  const text = readFileSync(path, "utf8");
  if (!text.startsWith("---\n")) {
    ctx.errors.push(`${rel(ctx, path)}: missing YAML frontmatter (file must start with ---)`);
    return;
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    ctx.errors.push(`${rel(ctx, path)}: unterminated YAML frontmatter`);
    return;
  }
  const data = parseFrontmatter(text.slice(4, end));
  if (!data) {
    ctx.errors.push(`${rel(ctx, path)}: frontmatter did not parse to a mapping`);
    return;
  }
  for (const key of ["name", "description"]) {
    if (!data[key]) {
      ctx.errors.push(`${rel(ctx, path)}: frontmatter missing required key '${key}'`);
    }
  }

  const allowedTools = data["allowed-tools"] ?? "";
  if (typeof allowedTools === "string") {
    for (const match of allowedTools.matchAll(/bun run ([^\s)]+)/g)) {
      const target = match[1]!.replace(/\*+$/, "");
      if (!target || target.endsWith("/")) continue;
      // Targets may contain globs (e.g. .pi-agent/skills/*/cli/src/cli.ts);
      // require at least one existing file to match.
      if (target.includes("*")) {
        if (
          !globHasMatches(ctx, ctx.root, target) &&
          !globHasMatches(ctx, join(ctx.root, ".agents"), target)
        ) {
          ctx.errors.push(
            `${rel(ctx, path)}: allowed-tools glob matches no files: ${target}`,
          );
        }
      } else {
        const candidates = [join(ctx.root, target), join(ctx.root, ".agents", target)];
        if (!candidates.some((c) => existsSync(c))) {
          ctx.errors.push(
            `${rel(ctx, path)}: allowed-tools references a missing file: ${target}`,
          );
        }
      }
    }
  }
}

export function checkSettings(ctx: LintContext): void {
  const path = join(ctx.root, ".pi-agent", "settings.json");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    ctx.errors.push(`.pi-agent/settings.json: ${err}`);
    return;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    ctx.errors.push(`.pi-agent/settings.json: ${err}`);
    return;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    ctx.errors.push(".pi-agent/settings.json: expected top-level JSON value to be an object");
  }
}

function listSkillFiles(root: string): string[] {
  const skillsDir = join(root, ".pi-agent", "skills");
  if (!existsSync(skillsDir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(skillsDir)) {
    const candidate = join(skillsDir, entry, "SKILL.md");
    if (existsSync(candidate)) out.push(candidate);
  }
  return out.sort();
}

export function lintSkillsMain(_argv: string[], root: string = ROOT): number {
  const ctx: LintContext = { root: isAbsolute(root) ? root : join(ROOT, root), errors: [] };
  const skills = listSkillFiles(ctx.root);
  if (!skills.length) {
    ctx.errors.push("no SKILL.md files found - glob roots are wrong or the tree moved");
  }

  for (const skill of skills) checkSkill(ctx, skill);
  checkSettings(ctx);

  if (ctx.errors.length) {
    console.log(`lint_skills: ${ctx.errors.length} failure(s)`);
    for (const err of ctx.errors) console.log(`  - ${err}`);
    return 1;
  }
  console.log(`lint_skills: OK (${skills.length} skills, settings.json)`);
  return 0;
}
