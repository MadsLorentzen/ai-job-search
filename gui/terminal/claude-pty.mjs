import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { buildInteractiveClaudeArgs, claudeSpawnPlan, resolveCommand } from "../claude.mjs";

const require = createRequire(import.meta.url);

export const RESIZE_BOUNDS = { minCols: 2, maxCols: 500, minRows: 2, maxRows: 200 };
const MAX_WRITE = 8192;

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function createClaudePty({
  workspace,
  sessionId,
  permissionMode = "safe",
  name,
  resolveClaude = () => resolveCommand("claude"),
  spawnPlan = claudeSpawnPlan,
  spawnPty,
  killProcessTree,
  createId = () => randomUUID(),
} = {}) {
  let proc = null;
  let started = false;
  let disposed = false;
  const id = createId();
  const dataListeners = new Set();
  const exitListeners = new Set();

  function requireSpawn() {
    if (typeof spawnPty === "function") return spawnPty;
    throw new Error("pty-unavailable");
  }

  function start({ cols = 80, rows = 24 } = {}) {
    if (started && !disposed) throw new Error("already-started");
    if (!sessionId) throw new Error("session-id-required");
    if (!workspace) throw new Error("workspace-required");
    const resolved = resolveClaude();
    const plan = spawnPlan(resolved);
    if (plan.shell) throw new Error("opaque-shell-fallback");
    const file = plan.file || resolved;
    const args = [...(plan.prefixArgs || []), ...buildInteractiveClaudeArgs({ sessionId, permissionMode, name })];
    const spawn = requireSpawn();
    proc = spawn(file, args, {
      cwd: workspace,
      cols: clamp(cols, RESIZE_BOUNDS.minCols, RESIZE_BOUNDS.maxCols, 80),
      rows: clamp(rows, RESIZE_BOUNDS.minRows, RESIZE_BOUNDS.maxRows, 24),
    });
    started = true;
    disposed = false;
    proc.on?.("data", (chunk) => {
      for (const listener of dataListeners) listener(String(chunk));
    });
    proc.on?.("exit", (code) => {
      for (const listener of exitListeners) listener({ code });
    });
    return { id, file, args, cwd: workspace };
  }

  function write(data) {
    if (disposed || !proc) throw new Error("not-started");
    if (typeof data !== "string") throw new Error("bounded-string-required");
    if (data.length > MAX_WRITE) throw new Error("write-too-large");
    proc.write(data);
  }

  function resize(cols, rows) {
    if (disposed || !proc) throw new Error("not-started");
    const nextCols = clamp(cols, RESIZE_BOUNDS.minCols, RESIZE_BOUNDS.maxCols, 80);
    const nextRows = clamp(rows, RESIZE_BOUNDS.minRows, RESIZE_BOUNDS.maxRows, 24);
    proc.resize(nextCols, nextRows);
    return { cols: nextCols, rows: nextRows };
  }

  function dispose() {
    if (disposed) return { ok: true, idempotent: true, id };
    disposed = true;
    try {
      proc?.kill?.();
    } catch {
      // Process may already be gone.
    }
    if (killProcessTree && proc?.pid) {
      setTimeout(() => {
        try { killProcessTree(proc.pid); } catch { /* already dead */ }
      }, 1500).unref?.();
    }
    proc = null;
    return { ok: true, id };
  }

  return {
    id,
    start,
    write,
    resize,
    dispose,
    onData(listener) {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },
    onExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    get started() { return started && !disposed; },
  };
}

export function defaultSpawnPty(file, args, options) {
  const pty = require("node-pty");
  return pty.spawn(file, args, {
    name: "xterm-256color",
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: process.env,
  });
}
