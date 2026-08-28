import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

const ARGUMENT_KINDS = new Set(["text", "url", "path", "integer", "boolean", "choice", "multiline"]);

function workspaceRelative(workspace, absolute) {
  return relative(workspace, absolute).split("\\").join("/");
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const yamlText = raw.slice(4, end).replace(/\r/g, "");
  return { data: parseYaml(yamlText) || {}, body: raw.slice(end + 4) };
}

function validateArgument(argument, invocation) {
  if (!ARGUMENT_KINDS.has(argument.kind)) {
    throw new Error(`${invocation}: unknown argument kind ${argument.kind}`);
  }
  if (!argument.name) throw new Error(`${invocation}: argument name is required`);
  if (argument.flag) {
    argument.flag = String(argument.flag).trim();
    if (!/^[a-z0-9-]+$/i.test(argument.flag.replace(/^--/, ""))) {
      throw new Error(`${invocation}: invalid flag ${argument.flag}`);
    }
  }
  if (argument.kind === "choice" && !Array.isArray(argument.values)) {
    throw new Error(`${invocation}: choice ${argument.name} needs values`);
  }
  return argument;
}

function definitionFromDesk(desk, sourcePath, sourceKind) {
  if (!desk || typeof desk !== "object") return null;
  if (!desk.id || !desk.invocation) {
    throw new Error(`${sourcePath}: desk.id and desk.invocation are required`);
  }
  return Object.freeze({
    id: desk.id,
    invocation: desk.invocation,
    title: desk.title || desk.id,
    description: desk.description || "",
    sourcePath,
    sourceKind,
    primaryOrder: desk.primaryOrder,
    arguments: Object.freeze((desk.arguments || []).map((argument) => Object.freeze(validateArgument(argument, desk.invocation)))),
    examples: Object.freeze([...(desk.examples || [])]),
    requirements: Object.freeze([...(desk.requirements || [])]),
  });
}

async function readDefinition(workspace, absolute, sourceKind) {
  const raw = await readFile(absolute, "utf8");
  const { data } = parseFrontmatter(raw);
  return definitionFromDesk(data.desk, workspaceRelative(workspace, absolute), sourceKind);
}

export async function createCommandRegistry({ workspace } = {}) {
  if (!workspace) throw new Error("workspace is required");
  const definitions = [];
  const seen = new Set();

  const commandDir = join(workspace, ".claude", "commands");
  for (const name of await readdir(commandDir)) {
    if (!name.endsWith(".md")) continue;
    const definition = await readDefinition(workspace, join(commandDir, name), "command");
    if (!definition) continue;
    if (seen.has(definition.id)) throw new Error(`Duplicate command id ${definition.id}`);
    seen.add(definition.id);
    definitions.push(definition);
  }

  const skillRoot = join(workspace, ".claude", "skills");
  for (const name of await readdir(skillRoot)) {
    const skillFile = join(skillRoot, name, "SKILL.md");
    try {
      const definition = await readDefinition(workspace, skillFile, "skill");
      if (!definition) continue;
      if (seen.has(definition.id)) throw new Error(`Duplicate command id ${definition.id}`);
      seen.add(definition.id);
      definitions.push(definition);
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
      throw error;
    }
  }

  definitions.sort((left, right) => {
    const leftOrder = left.primaryOrder ?? Number.POSITIVE_INFINITY;
    const rightOrder = right.primaryOrder ?? Number.POSITIVE_INFINITY;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.id.localeCompare(right.id);
  });

  const byId = new Map(definitions.map((item) => [item.id, item]));

  return {
    list() {
      return definitions;
    },
    get(id) {
      return byId.get(id);
    },
    render(id, values = {}) {
      const definition = byId.get(id);
      if (!definition) throw new Error(`Unknown command ${id}`);
      const parts = [definition.invocation];
      let multiline = "";
      for (const argument of definition.arguments) {
        const value = values[argument.name];
        if (value == null || value === "" || value === false) continue;
        if (argument.kind === "boolean") {
          parts.push(argument.flag.startsWith("--") ? argument.flag : `--${argument.flag}`);
          continue;
        }
        if (argument.kind === "multiline") {
          multiline = String(value);
          continue;
        }
        if (argument.flag) {
          parts.push(argument.flag.startsWith("--") ? argument.flag : `--${argument.flag}`, String(value));
          continue;
        }
        parts.push(String(value));
      }
      const rendered = parts.join(" ").trim();
      return multiline ? `${rendered}\n${multiline}` : rendered;
    },
  };
}
