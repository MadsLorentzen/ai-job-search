/**
 * Create a job-search folder for the installable desk. Prefer git. If git is
 * missing (common after a Start Menu launch), download the public zip instead.
 */
import { execFile, execFileSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { get as httpsGet } from "node:https";
import { isJobSearchWorkspace } from "./claude.mjs";
import { TEMPLATE_REPO, templateArchiveRoot, templateArchiveUrl } from "./defaults.mjs";

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === "win32";

export function gitSearchDirs(env = process.env) {
  const dirs = [];
  if (IS_WIN) {
    const pf = env.ProgramFiles || "C:\\Program Files";
    const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    dirs.push(join(pf, "Git", "cmd"), join(pf86, "Git", "cmd"));
    if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, "Programs", "Git", "cmd"));
  }
  dirs.push("/usr/bin", "/opt/homebrew/bin", "/usr/local/bin");
  return dirs;
}

export function resolveGit(env = process.env) {
  const extra = gitSearchDirs(env).join(delimiter);
  const merged = { ...env, PATH: extra ? `${extra}${delimiter}${env.PATH || ""}` : env.PATH };
  try {
    const found = execFileSync(IS_WIN ? "where" : "which", ["git"], {
      encoding: "utf8",
      env: merged,
      windowsHide: true,
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const preferred = found.find((line) => /\.exe$/i.test(line)) || found[0];
    if (preferred && existsSync(preferred)) return preferred;
  } catch {
    // Packaged Electron often has a PATH that never saw Git for Windows.
  }
  for (const dir of gitSearchDirs(env)) {
    for (const name of IS_WIN ? ["git.exe", "git"] : ["git"]) {
      const path = join(dir, name);
      if (existsSync(path)) return path;
    }
  }
  return "";
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (href, hops = 0) => {
      if (hops > 6) {
        reject(new Error("Download failed: too many redirects."));
        return;
      }
      httpsGet(href, { headers: { "User-Agent": "JobSearchDesk" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          follow(res.headers.location, hops + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download failed (${res.statusCode}). Check your network and try again.`));
          return;
        }
        const file = createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close((err) => (err ? reject(err) : resolve())));
        file.on("error", reject);
      }).on("error", reject);
    };
    follow(url);
  });
}

async function moveDir(from, to) {
  try {
    await rename(from, to);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    await cp(from, to, { recursive: true });
    await rm(from, { recursive: true, force: true });
  }
}

async function extractZip(zip, dest) {
  if (IS_WIN) {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath "${zip}" -DestinationPath "${dest}" -Force`],
      { windowsHide: true, timeout: 120000 },
    );
    return;
  }
  await execFileAsync("unzip", ["-o", zip, "-d", dest], { timeout: 120000 });
}

async function cloneWithGit(dest, env = process.env) {
  const git = resolveGit(env);
  if (!git) return { error: "git-missing" };
  try {
    await execFileAsync(git, ["clone", "--depth", "1", TEMPLATE_REPO, dest], {
      env: { ...env, PATH: `${gitSearchDirs(env).join(delimiter)}${delimiter}${env.PATH || ""}` },
      timeout: 180000,
      windowsHide: true,
    });
    return { ok: true };
  } catch (err) {
    return { error: err.stderr?.toString().trim() || err.message || "git clone failed" };
  }
}

async function downloadTemplate(dest) {
  const scratch = await mkdtemp(join(tmpdir(), "desk-template-"));
  const zip = join(scratch, "template.zip");
  try {
    await downloadFile(templateArchiveUrl(), zip);
    const unpacked = join(scratch, "unpacked");
    await extractZip(zip, unpacked);
    const inner = join(unpacked, templateArchiveRoot());
    if (!existsSync(inner)) {
      return { error: "The downloaded framework zip did not contain the expected folder." };
    }
    await moveDir(inner, dest);
    return { ok: true };
  } catch (err) {
    return { error: err.message || "Could not download the public framework." };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function createWorkspace(dest, env = process.env) {
  if (existsSync(dest)) {
    if (isJobSearchWorkspace(dest)) return { ok: true };
    return { error: `${dest} already exists and is not a job-search repo.` };
  }

  const cloned = await cloneWithGit(dest, env);
  if (cloned.ok) {
    if (!isJobSearchWorkspace(dest)) {
      return { error: "Clone finished but the folder looks incomplete." };
    }
    return { ok: true };
  }

  await rm(dest, { recursive: true, force: true });
  const downloaded = await downloadTemplate(dest);
  if (downloaded.ok) {
    if (!isJobSearchWorkspace(dest)) {
      return { error: "Download finished but the folder looks incomplete." };
    }
    return { ok: true };
  }

  if (cloned.error === "git-missing") {
    return {
      error:
        downloaded.error ||
        "Could not create a workspace. Connect to the internet and try again, or install Git and retry.",
    };
  }
  return {
    error: `${cloned.error} ${downloaded.error || ""}`.trim(),
  };
}
