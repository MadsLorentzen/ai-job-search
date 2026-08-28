import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("runtime dependencies are production dependencies without lifecycle scripts", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  assert.ok(pkg.dependencies["@anthropic-ai/claude-agent-sdk"]);
  assert.ok(pkg.dependencies.ws);
  assert.ok(pkg.dependencies.yaml);
  assert.ok(pkg.dependencies.diff);
  assert.ok(pkg.dependencies["node-pty"]);
  assert.ok(pkg.dependencies["@xterm/xterm"]);
  assert.ok(pkg.dependencies["@xterm/addon-fit"]);
  assert.equal(pkg.scripts.postinstall, undefined);
  assert.match(pkg.scripts["test:unit"], /node --test/);
  assert.match(pkg.scripts["test:renderer"], /tests\/renderer/);
  assert.match(pkg.scripts["build:renderer"], /esbuild public\/src\/desk\.js/);
  assert.match(pkg.scripts["rebuild:native"], /install-app-deps/);
  assert.match(pkg.scripts["test:packaged"], /validate-package/);
  assert.match(pkg.scripts.dist, /build:renderer/);
  assert.match(pkg.scripts["dist:dir"], /build:renderer/);
  assert.ok(pkg.devDependencies.esbuild);
  assert.ok(pkg.devDependencies["happy-dom"]);
  assert.ok(pkg.devDependencies["@playwright/test"]);
});
