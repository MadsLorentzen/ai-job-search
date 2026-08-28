import { createHash, randomUUID } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import { promises as defaultFs } from "node:fs";
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

const DEFAULT_PREVIEW_BYTES = 512 * 1024;
const DEFAULT_DIFF_BYTES = 128 * 1024;
const DEFAULT_SNAPSHOT_FILES = 4000;
const HASH_BYTES = 1024 * 1024;
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

const IGNORE = [
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)release(\/|$)/i,
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)credentials\.json$/i,
  /\.(pem|key|p12|pfx)$/i,
  /\.(aux|lof|lot|toc|out|fls|fdb_latexmk|synctex\.gz|nav|snm|vrb|bbl|blg)$/i,
];

const PREVIEW_TYPES = {
  ".pdf": { mime: "application/pdf", kind: "pdf" },
  ".png": { mime: "image/png", kind: "image" },
  ".jpg": { mime: "image/jpeg", kind: "image" },
  ".jpeg": { mime: "image/jpeg", kind: "image" },
  ".gif": { mime: "image/gif", kind: "image" },
  ".webp": { mime: "image/webp", kind: "image" },
  ".txt": { mime: "text/plain", kind: "text" },
  ".md": { mime: "text/markdown", kind: "text" },
  ".json": { mime: "application/json", kind: "text" },
  ".csv": { mime: "text/csv", kind: "text" },
  ".tex": { mime: "text/x-tex", kind: "text" },
  ".html": { mime: "text/html", kind: "html" },
  ".htm": { mime: "text/html", kind: "html" },
};

function fail(message) {
  const error = new Error(message);
  error.code = "ARTIFACT_PATH";
  throw error;
}

function posix(rel) {
  return String(rel).split(sep).join("/");
}

export function shouldIgnoreArtifact(relativePath) {
  const rel = posix(relativePath);
  return IGNORE.some((pattern) => pattern.test(rel));
}

export function previewTypeFor(relativePath) {
  return PREVIEW_TYPES[extname(relativePath).toLowerCase()] || null;
}

export function resolveWorkspaceArtifactPath(workspace, candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) fail("empty path");
  if (candidate.includes("\0")) fail("nul");
  if (/^[a-zA-Z]:/.test(candidate)) fail("absolute drive");
  if (candidate.startsWith("\\\\") || candidate.startsWith("//")) fail("unc");
  if (isAbsolute(candidate)) fail("absolute");
  // Treat Windows separators as path segments on every OS so `..\\cv` cannot
  // pass as a literal filename on Linux CI or in a packaged Linux build.
  const normalized = posix(normalize(candidate.replace(/\\/g, "/")));
  if (normalized === ".." || normalized.startsWith("../") || normalized.split("/").includes("..")) {
    fail("traversal");
  }
  if (normalized.split("/").some((part) => DEVICE_NAME.test(part))) fail("device");
  const absolutePath = resolve(workspace, ...normalized.split("/"));
  const root = resolve(workspace);
  const rel = posix(relative(root, absolutePath));
  if (!rel || rel.startsWith("../") || rel === ".." || isAbsolute(rel)) fail("escape");
  if (process.platform === "win32" && root.slice(0, 2).toLowerCase() !== absolutePath.slice(0, 2).toLowerCase()) {
    fail("alternate-drive");
  }
  return { relativePath: rel, absolutePath };
}

async function assertNoLinkEscape(fs, workspace, absolutePath) {
  const root = await fs.realpath(resolve(workspace)).catch(() => resolve(workspace));
  let current = absolutePath;
  for (let i = 0; i < 64; i += 1) {
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch {
      break;
    }
    if (stat.isSymbolicLink()) {
      const target = await fs.realpath(current).catch(() => null);
      if (!target) fail("link escape");
      const rel = posix(relative(root, target));
      if (!rel || rel.startsWith("../") || rel === ".." || isAbsolute(rel)) fail("link escape");
    }
    const parent = dirname(current);
    if (parent === current) break;
    if (posix(relative(root, parent)).startsWith("..") && resolve(parent) !== root) break;
    current = parent;
  }
}

async function hashFile(fs, absolutePath, size) {
  if (size > HASH_BYTES) return `size:${size}`;
  const body = await fs.readFile(absolutePath);
  return createHash("sha256").update(body).digest("hex");
}

function publicRecord(record) {
  return {
    id: record.id,
    turnId: record.turnId,
    relativePath: record.relativePath,
    kind: record.kind,
    mime: record.mime,
    size: record.size,
    previewKind: record.previewKind,
  };
}

export function createArtifactService({
  workspace,
  fs = defaultFs,
  createId = () => randomUUID(),
  maxPreviewBytes = DEFAULT_PREVIEW_BYTES,
  maxDiffBytes = DEFAULT_DIFF_BYTES,
  maxSnapshotFiles = DEFAULT_SNAPSHOT_FILES,
  openImpl = { open() {}, reveal() {} },
} = {}) {
  if (!workspace) throw new Error("workspace is required");
  const records = new Map();
  const snapshots = new Map();

  async function walk(dir, relBase, out) {
    if (out.length >= maxSnapshotFiles) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxSnapshotFiles) return;
      const rel = posix(relBase ? `${relBase}/${entry.name}` : entry.name);
      if (shouldIgnoreArtifact(rel)) continue;
      const absolute = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(absolute, rel, out);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(absolute);
      const type = previewTypeFor(rel);
      const item = {
        relativePath: rel,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        hash: await hashFile(fs, absolute, stat.size),
        previousText: null,
      };
      if (type?.kind === "text" && stat.size <= maxDiffBytes) {
        item.previousText = await fs.readFile(absolute, "utf8");
      }
      out.push(item);
    }
  }

  async function snapshot() {
    const files = [];
    await walk(workspace, "", files);
    return new Map(files.map((item) => [item.relativePath, item]));
  }

  async function resolveExisting(relativePath) {
    const resolved = resolveWorkspaceArtifactPath(workspace, relativePath);
    await assertNoLinkEscape(fs, workspace, resolved.absolutePath);
    const real = await fs.realpath(resolved.absolutePath).catch(() => null);
    if (real) {
      const rel = posix(relative(resolve(workspace), real));
      if (!rel || rel.startsWith("../") || isAbsolute(rel)) fail("link escape");
    }
    return resolved;
  }

  function remember(record) {
    records.set(record.id, record);
    return record;
  }

  async function recordFromPath(relativePath, { turnId, kind, previousText = null } = {}) {
    const resolved = await resolveExisting(relativePath);
    if (shouldIgnoreArtifact(resolved.relativePath)) return null;
    const stat = await fs.stat(resolved.absolutePath);
    const type = previewTypeFor(resolved.relativePath);
    return remember({
      id: createId(),
      turnId,
      kind,
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      size: stat.size,
      mime: type?.mime || "application/octet-stream",
      previewKind: type?.kind || "unknown",
      previousText,
    });
  }

  return {
    async beginTurn(turnId) {
      snapshots.set(turnId, await snapshot());
    },
    async settleTurn(turnId) {
      const before = snapshots.get(turnId);
      if (!before) return [];
      const after = await snapshot();
      const found = [];
      for (const [relativePath, current] of after) {
        const previous = before.get(relativePath);
        if (!previous) {
          const record = await recordFromPath(relativePath, { turnId, kind: "created" });
          if (record) found.push(record);
          continue;
        }
        if (previous.size !== current.size || previous.hash !== current.hash || previous.mtimeMs !== current.mtimeMs) {
          const record = await recordFromPath(relativePath, {
            turnId,
            kind: "modified",
            previousText: previous.previousText,
          });
          if (record) found.push(record);
        }
      }
      snapshots.delete(turnId);
      return found;
    },
    async registerFromPath(relativePath, extras = {}) {
      const record = await recordFromPath(relativePath, { kind: extras.kind || "created", turnId: extras.turnId || null });
      if (!record) fail("ignored path");
      return record;
    },
    list() {
      return [...records.values()].map(publicRecord);
    },
    get(id) {
      return records.get(id) || null;
    },
    async preview(id) {
      const record = records.get(id);
      if (!record) fail("unknown artifact");
      await assertNoLinkEscape(fs, workspace, record.absolutePath);
      if (!record.previewKind || record.previewKind === "unknown") fail("unsupported preview");
      if (record.size > maxPreviewBytes) fail("too large");
      if (record.previewKind === "text" || record.previewKind === "html") {
        const text = await fs.readFile(record.absolutePath, "utf8");
        return { id, kind: record.previewKind, mime: record.mime, text, relativePath: record.relativePath };
      }
      const bytes = await fs.readFile(record.absolutePath);
      return { id, kind: record.previewKind, mime: record.mime, bytes, relativePath: record.relativePath };
    },
    async compare(id) {
      const record = records.get(id);
      if (!record) fail("unknown artifact");
      if (record.previewKind !== "text") fail("not-text");
      if (record.size > maxDiffBytes) fail("too large");
      const current = await fs.readFile(record.absolutePath, "utf8");
      const previous = record.previousText ?? "";
      return {
        id,
        relativePath: record.relativePath,
        diff: createTwoFilesPatch(record.relativePath, record.relativePath, previous, current),
      };
    },
    async open(id) {
      const record = records.get(id);
      if (!record) fail("unknown artifact");
      const resolved = await resolveExisting(record.relativePath);
      await openImpl.open(resolved.absolutePath);
      return { id, relativePath: resolved.relativePath, absolutePath: resolved.absolutePath };
    },
    async reveal(id) {
      const record = records.get(id);
      if (!record) fail("unknown artifact");
      const resolved = await resolveExisting(record.relativePath);
      await openImpl.reveal(resolved.absolutePath);
      return { id, relativePath: resolved.relativePath, absolutePath: resolved.absolutePath };
    },
  };
}

export const ARTIFACT_HTML_CSP = "default-src 'none'; sandbox; style-src 'unsafe-inline'; img-src data:";
