import { build } from "esbuild";
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const extensionRoot = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(extensionRoot, "dist");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
mkdirSync(path.join(distDir, "background"), { recursive: true });
mkdirSync(path.join(distDir, "content"), { recursive: true });
mkdirSync(path.join(distDir, "icons"), { recursive: true });

await build({
  entryPoints: [path.join(extensionRoot, "src/background/index.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome110",
  outfile: path.join(distDir, "background/index.js"),
});

await build({
  entryPoints: [path.join(extensionRoot, "src/content/index.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome110",
  outfile: path.join(distDir, "content/index.js"),
});

const manifest = JSON.parse(readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));
writeFileSync(path.join(distDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

for (const size of [16, 48, 128]) {
  copyFileSync(
    path.join(extensionRoot, "icons", `icon${size}.png`),
    path.join(distDir, "icons", `icon${size}.png`),
  );
}

console.log("Built extension/dist/");
