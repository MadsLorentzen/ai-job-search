import { promises as defaultFs } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const SCHEMA_VERSION = 1;
const MODES = new Set(["safe", "autonomous"]);

export function permissionPolicyPath(workspace) {
  return join(workspace, ".claude", "desk", "permission-policy.json");
}

export function normalizeDeskPermissionMode(value) {
  return value === "autonomous" ? "autonomous" : "safe";
}

export function sdkPermissionMode(mode) {
  return mode === "autonomous" ? "bypassPermissions" : "default";
}

export function allowDangerouslySkipPermissions(mode) {
  return mode === "autonomous";
}

function parseStoredMode(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== SCHEMA_VERSION) {
    return "safe";
  }
  return MODES.has(value.mode) ? value.mode : "safe";
}

export function createPermissionPolicy({
  workspace,
  fs = defaultFs,
  createId = () => randomUUID(),
} = {}) {
  const path = permissionPolicyPath(workspace);
  let mode = "safe";
  let loaded = false;

  async function persist() {
    const dir = dirname(path);
    await fs.mkdir(dir, { recursive: true });
    const tmp = join(dir, `permission-policy.${createId()}.tmp`);
    const body = `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, mode }, null, 2)}\n`;
    await fs.writeFile(tmp, body);
    try {
      await fs.rename(tmp, path);
    } catch (error) {
      try { await fs.unlink(tmp); } catch { /* keep the previous file */ }
      throw error;
    }
  }

  async function load() {
    try {
      const raw = await fs.readFile(path, "utf8");
      try {
        mode = parseStoredMode(JSON.parse(raw));
      } catch {
        mode = "safe";
      }
    } catch (error) {
      if (error && error.code !== "ENOENT") throw error;
      mode = "safe";
    }
    loaded = true;
    return mode;
  }

  return {
    get() {
      return mode;
    },
    async load() {
      return load();
    },
    async set(nextMode) {
      if (!loaded) await load();
      mode = normalizeDeskPermissionMode(nextMode);
      await persist();
      return mode;
    },
  };
}
