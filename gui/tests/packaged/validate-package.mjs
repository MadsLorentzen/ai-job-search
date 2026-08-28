#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GUI = join(HERE, "..", "..");
const pkg = JSON.parse(readFileSync(join(GUI, "package.json"), "utf8"));
const yml = readFileSync(join(GUI, "electron-builder.yml"), "utf8");

assert.match(pkg.scripts["rebuild:native"], /electron-builder install-app-deps/);
assert.match(pkg.scripts["test:packaged"], /validate-package/);
assert.match(pkg.scripts.dist, /build:renderer/);
assert.match(pkg.scripts["dist:dir"], /build:renderer/);
assert.equal(pkg.scripts.postinstall, undefined);
assert.match(yml, /terminal\/\*\*\/\*/);
assert.match(yml, /public\/dist\/\*\*\/*/);
assert.match(yml, /node_modules\/node-pty\/\*\*\/\*/);
assert.match(yml, /\*\*\/\*\.node/);
assert.match(yml, /npmRebuild:\s*true/);

function looksLikeUnpackedApp(dir) {
  return existsSync(join(dir, "resources", "app.asar"))
    || existsSync(join(dir, "JobSearchDesk.exe"))
    || existsSync(join(dir, "Job Search Desk.exe"))
    || existsSync(join(dir, "job-search-desk"));
}

const candidates = [
  process.env.JOB_SEARCH_UNPACKED_DIR,
  ...["win-unpacked", "linux-unpacked", "mac", "mac-arm64"].map((name) => join(GUI, "release", name)),
].filter(Boolean);
const unpacked = candidates.find((dir) => existsSync(dir) && looksLikeUnpackedApp(dir));

if (!unpacked) {
  console.log("Packaging config is valid. No unpacked app found; skipping runtime launch.");
  process.exit(0);
}

function walk(dir, seen = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, seen);
    else seen.push(path);
  }
  return seen;
}

const files = walk(unpacked);
const hasPty = files.some((path) => path.includes("node-pty") || path.endsWith(".node"));
const hasRenderer = files.some((path) => path.replace(/\\/g, "/").includes("public/dist/desk.js"))
  || files.some((path) => path.endsWith("app.asar"));
if (!hasPty || !hasRenderer) {
  if (process.env.JOB_SEARCH_REQUIRE_PACKAGED === "1") {
    assert.ok(hasPty, "unpacked app must include native PTY files");
    assert.ok(hasRenderer, "unpacked app must include bundled renderer");
  }
  console.log(`Packaging config is valid. ${unpacked} looks like a stale unpacked build; run dist:dir to refresh it.`);
  process.exit(0);
}
console.log(`Validated unpacked app at ${unpacked}`);
