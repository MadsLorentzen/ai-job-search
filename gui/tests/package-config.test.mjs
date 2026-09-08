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
  assert.ok(pkg.dependencies["electron-updater"]);
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

test("Windows installer replaces the previous Desk and can keep a copy", async () => {
  const yml = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
  const nsis = await readFile(new URL("../build/installer.nsh", import.meta.url), "utf8");
  assert.match(yml, /oneClick:\s*false/);
  // The install directory must stay fixed: electron-builder's uninstaller runs
  // RMDir /r $INSTDIR, so a user-chosen folder could be a job-search workspace.
  assert.match(yml, /allowToChangeInstallationDirectory:\s*false/);
  assert.match(yml, /include:\s*build\/installer\.nsh/);
  assert.match(yml, /deleteAppDataOnUninstall:\s*false/);
  assert.match(yml, /provider:\s*github/);
  assert.match(yml, /owner:\s*iLevyTate/);
  assert.match(yml, /repo:\s*ai-job-search/);
  assert.match(nsis, /replace it with this version/);
  assert.match(nsis, /keep a copy of the old app/);
  // A wildcard CopyFiles skips subdirectories; robocopy /E keeps app.asar.
  assert.match(nsis, /robocopy/);
  assert.match(nsis, /Job Search Desk \(previous\)\.lnk/);
  // Unused NSIS Var fails CI: makensis warning 6001 is treated as an error.
  assert.doesNotMatch(nsis, /^\s*Var\s+/m);
});
