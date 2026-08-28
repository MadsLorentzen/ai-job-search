import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createArtifactService, resolveWorkspaceArtifactPath } from "../artifacts.mjs";

function workspace() {
  return mkdtempSync(join(tmpdir(), "desk-artifacts-"));
}

function write(root, rel, body = "x") {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return path;
}

test("settleTurn records created and modified files", async () => {
  const root = workspace();
  write(root, "cv/old.tex", "old");
  const service = createArtifactService({ workspace: root, createId: (() => {
    let n = 0;
    return () => `art-${++n}`;
  })() });
  await service.beginTurn("turn-1");
  write(root, "cv/new.tex", "created");
  write(root, "cv/old.tex", "changed");
  const found = await service.settleTurn("turn-1");
  assert.deepEqual(found.map((item) => [item.kind, item.relativePath]).sort(), [
    ["created", "cv/new.tex"],
    ["modified", "cv/old.tex"],
  ]);
  assert.equal(found.find((item) => item.kind === "modified").previousText, "old");
});

test("build intermediates, secrets, and ignored trees are skipped", async () => {
  const root = workspace();
  const service = createArtifactService({ workspace: root });
  await service.beginTurn("turn-2");
  write(root, "node_modules/pkg/index.js", "secret");
  write(root, ".git/config", "git");
  write(root, "gui/release/app.exe", "bin");
  write(root, ".env", "KEY=1");
  write(root, "credentials.json", "{}");
  write(root, "cv/main.aux", "latex");
  write(root, "cv/keep.tex", "ok");
  const found = await service.settleTurn("turn-2");
  assert.deepEqual(found.map((item) => item.relativePath), ["cv/keep.tex"]);
});

test("preview and compare honor MIME and size bounds", async () => {
  const root = workspace();
  write(root, "notes.md", "# Hi");
  write(root, "huge.md", "x".repeat(200_000));
  write(root, "photo.bin", Buffer.from([1, 2, 3]));
  const service = createArtifactService({
    workspace: root,
    maxPreviewBytes: 1024,
    maxDiffBytes: 64,
  });
  await service.beginTurn("turn-3");
  write(root, "notes.md", "# Hello");
  write(root, "huge.md", `${"y".repeat(200_000)}`);
  write(root, "cover.html", "<p>hi</p>");
  const found = await service.settleTurn("turn-3");
  const notes = found.find((item) => item.relativePath === "notes.md");
  const html = found.find((item) => item.relativePath === "cover.html");
  const preview = await service.preview(notes.id);
  assert.equal(preview.kind, "text");
  assert.match(preview.text, /Hello/);
  const compared = await service.compare(notes.id);
  assert.match(compared.diff, /Hello/);
  await assert.rejects(() => service.preview(found.find((item) => item.relativePath === "huge.md").id), /too large|size/i);
  const htmlPreview = await service.preview(html.id);
  assert.equal(htmlPreview.kind, "html");
  assert.equal(htmlPreview.mime, "text/html");
});

test("resolveWorkspaceArtifactPath rejects absolute, traversal, drive, UNC, and NUL paths", () => {
  const root = workspace();
  assert.throws(() => resolveWorkspaceArtifactPath(root, join(root, "cv", "x.tex")), /absolute|escape/i);
  assert.throws(() => resolveWorkspaceArtifactPath(root, "../cv/x.tex"), /traversal|escape/i);
  assert.throws(() => resolveWorkspaceArtifactPath(root, "..\\cv\\x.tex"), /traversal|escape/i);
  assert.throws(() => resolveWorkspaceArtifactPath(root, "C:\\\\Windows\\\\x.tex"), /absolute|drive/i);
  assert.throws(() => resolveWorkspaceArtifactPath(root, "\\\\server\\share\\x.tex"), /unc/i);
  assert.throws(() => resolveWorkspaceArtifactPath(root, "cv\\x.tex\0.pdf"), /nul/i);
  const safe = resolveWorkspaceArtifactPath(root, "cv/main.tex");
  assert.equal(safe.relativePath, "cv/main.tex");
  assert.ok(safe.absolutePath.startsWith(root));
});

test("symlink and junction escapes are rejected", async () => {
  const root = workspace();
  const outside = workspace();
  write(outside, "secret.txt", "nope");
  const escapeDir = join(root, "escape");
  try {
    symlinkSync(outside, escapeDir, "junction");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") return;
    throw error;
  }
  const service = createArtifactService({ workspace: root });
  await assert.rejects(() => service.registerFromPath("escape/secret.txt"), /link|escape/i);
  await assert.rejects(() => service.preview("missing"), /unknown/i);
});
