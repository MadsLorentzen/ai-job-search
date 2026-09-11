import { build } from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(extensionRoot, "dist", "extension");

export async function buildExtension() {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(resolve(outputRoot, "background"), { recursive: true });
  await mkdir(resolve(outputRoot, "content"), { recursive: true });
  await cp(resolve(extensionRoot, "manifest.json"), resolve(outputRoot, "manifest.json"));
  await build({
    entryPoints: [resolve(extensionRoot, "src", "background", "index.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    outfile: resolve(outputRoot, "background", "index.js"),
  });
  await build({
    entryPoints: [resolve(extensionRoot, "src", "content", "index.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    outfile: resolve(outputRoot, "content", "index.js"),
  });
  const manifest = JSON.parse(await readFile(resolve(outputRoot, "manifest.json"), "utf8"));
  if (manifest.background?.service_worker !== "background/index.js") {
    throw new Error("manifest service worker does not match the production bundle path");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildExtension();
}
