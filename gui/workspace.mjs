/**
 * Create a job-search folder for the installable desk. Prefer git. If git is
 * missing (common after a Start Menu launch), download the public zip instead.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cp, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { get as httpsGet } from "node:https";
import { commandLooksInstalled, isJobSearchWorkspace, resolveCommand, withClaudePath } from "./claude.mjs";
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
        // pipe() does not forward source errors: a connection reset mid-body
        // would otherwise be an uncaught exception that closes the whole app.
        res.on("error", (err) => {
          file.destroy();
          reject(err);
        });
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

/** Single-quote a value for PowerShell so $, backticks, and spaces stay literal. */
export function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function extractZip(zip, dest) {
  if (IS_WIN) {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath ${psQuote(zip)} -DestinationPath ${psQuote(dest)} -Force`],
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

const COMMON_WORKSPACE_NAMES = ["ai-job-search", "ai-job-search-personal"];

export function platformLabel(platform = process.platform) {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return "this";
}

function formatList(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

function addParent(parents, dir, label) {
  if (!dir || parents.some((item) => item.dir === dir)) return;
  parents.push({ dir, label });
}

/**
 * Usual clone locations for this OS build. Windows, Mac, and Linux installers
 * each get their own list so first-run names folders people actually use.
 */
export function workspaceLocationPlan(platform = process.platform, home = homedir(), env = process.env) {
  const parents = [];
  const slash = platform === "win32" ? "\\" : "/";

  if (platform === "win32") {
    addParent(parents, join(home, "Documents", "GitHub"), `Documents${slash}GitHub`);
    addParent(parents, join(home, "Documents"), "Documents");
    addParent(parents, join(home, "source", "repos"), `source${slash}repos`);
    addParent(parents, join(home, "Desktop"), "Desktop");
  } else if (platform === "darwin") {
    addParent(parents, join(home, "Documents", "GitHub"), "Documents/GitHub");
    addParent(parents, join(home, "Developer"), "Developer");
    addParent(parents, join(home, "Documents"), "Documents");
    addParent(parents, join(home, "Projects"), "Projects");
    addParent(parents, join(home, "src"), "src");
    addParent(parents, join(home, "Desktop"), "Desktop");
  } else {
    if (env.XDG_DOCUMENTS_DIR) addParent(parents, env.XDG_DOCUMENTS_DIR, "Documents");
    addParent(parents, join(home, "Documents", "GitHub"), "Documents/GitHub");
    addParent(parents, join(home, "Documents"), "Documents");
    addParent(parents, join(home, "src"), "src");
    addParent(parents, join(home, "Projects"), "Projects");
    addParent(parents, join(home, "code"), "code");
    addParent(parents, env.XDG_DESKTOP_DIR || join(home, "Desktop"), "Desktop");
  }

  return { platform, parents };
}

export function defaultBrowseDir(home = homedir(), platform = process.platform, env = process.env) {
  for (const { dir } of workspaceLocationPlan(platform, home, env).parents) {
    if (existsSync(dir)) return dir;
  }
  return home;
}

export function workspaceScanParents(home = homedir(), platform = process.platform, env = process.env) {
  return workspaceLocationPlan(platform, home, env)
    .parents
    .map((item) => item.dir)
    .filter((dir) => existsSync(dir));
}

export function existingWorkspaceHint(home = homedir(), platform = process.platform, env = process.env) {
  const labels = [...new Set(workspaceLocationPlan(platform, home, env).parents.map((item) => item.label))];
  const browse = defaultBrowseDir(home, platform, env);
  return `This ${platformLabel(platform)} build looks in ${formatList(labels)}. Open a folder that already has AGENTS.md and gui/. The folder picker starts in ${browse}.`;
}

export function openFolderHint(home = homedir(), platform = process.platform, env = process.env) {
  return `Opens the folder picker in ${defaultBrowseDir(home, platform, env)}`;
}

export function sameWorkspace(left, right) {
  if (!left || !right) return false;
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function findExistingWorkspaces(home = homedir(), platform = process.platform, env = process.env) {
  const found = [];
  const seen = new Set();
  const add = (root) => {
    if (!root || seen.has(root) || !isJobSearchWorkspace(root)) return;
    seen.add(root);
    found.push({ root, name: basename(root) });
  };

  const parents = workspaceLocationPlan(platform, home, env).parents.map((item) => item.dir);
  for (const name of COMMON_WORKSPACE_NAMES) {
    add(join(home, name));
    for (const parent of parents) add(join(parent, name));
  }
  for (const parent of parents) {
    if (!existsSync(parent)) continue;
    add(parent);
    try {
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory()) add(join(parent, entry.name));
      }
    } catch {
      // Skip folders we cannot read.
    }
  }
  return found;
}

/**
 * Pointer both the installable Desk and `node gui/server.mjs --cli` read.
 * Job files stay in the repo. This file only remembers which repo.
 */
export function sharedStateDir(home = homedir(), platform = process.platform, env = process.env) {
  if (platform === "win32") {
    return join(env.APPDATA || join(home, "AppData", "Roaming"), "ai-job-search");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "ai-job-search");
  }
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "ai-job-search");
}

export function sharedWorkspacePath(home = homedir(), platform = process.platform, env = process.env) {
  return join(sharedStateDir(home, platform, env), "workspace.json");
}

function pointerFiles(home = homedir(), platform = process.platform, env = process.env, extra = []) {
  return [sharedWorkspacePath(home, platform, env), join(home, ".ai-job-search", "workspace.json"), ...extra];
}

export function readSharedWorkspace(home = homedir(), platform = process.platform, env = process.env, extraPointers = []) {
  for (const file of pointerFiles(home, platform, env, extraPointers)) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (isJobSearchWorkspace(data.root)) return data.root;
    } catch {
      // Missing or stale pointer.
    }
  }
  return "";
}

export function writeSharedWorkspace(root, home = homedir(), platform = process.platform, env = process.env) {
  if (!isJobSearchWorkspace(root)) {
    return { error: "That folder is not a job-search repo. It needs AGENTS.md and gui/." };
  }
  const dir = sharedStateDir(home, platform, env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(sharedWorkspacePath(home, platform, env), `${JSON.stringify({ root }, null, 2)}\n`);
  return { ok: true, root };
}

export function resolveWorkspace({
  explicit = "",
  here = "",
  env = process.env,
  home = homedir(),
  platform = process.platform,
  extraPointers = [],
} = {}) {
  for (const root of [explicit, env.JOB_SEARCH_ROOT, readSharedWorkspace(home, platform, env, extraPointers), here]) {
    if (isJobSearchWorkspace(root)) return root;
  }
  return findExistingWorkspaces(home, platform, env)[0]?.root || "";
}

export function rememberWorkspace(root, home = homedir(), platform = process.platform, env = process.env) {
  return writeSharedWorkspace(root, home, platform, env);
}

/**
 * spawn() surfaces a missing binary as an async "error" event, not a throw.
 * Probe PATH first so the terminal loop can move on to the next candidate
 * instead of reporting success and leaving an unhandled error behind.
 */
export function hasBinary(bin, env = process.env) {
  try {
    execFileSync(IS_WIN ? "where" : "which", [bin], { env, stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * The /k payload must be the bare path: Node quotes spawn args itself, and a
 * pre-quoted path comes out as \" escapes that cmd.exe cannot parse.
 */
export function windowsCliLaunch(command, ready) {
  return ready ? command : "echo Claude Code is missing. Install it, then run claude here. Desk already uses this folder.";
}

function openCliTerminal(root, command, env) {
  const ready = commandLooksInstalled(command);
  if (process.platform === "win32") {
    const launch = windowsCliLaunch(command, ready);
    const child = spawn("cmd.exe", ["/c", "start", "Job Search CLI", "cmd.exe", "/k", launch], {
      cwd: root,
      env,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.on("error", () => {});
    child.unref();
    return { ok: true, root };
  }
  if (process.platform === "darwin") {
    const script = ready
      ? `cd ${JSON.stringify(root)} && exec ${JSON.stringify(command)}`
      : `cd ${JSON.stringify(root)} && echo Claude Code is missing. Install it, then run claude here.`;
    const child = spawn("osascript", ["-e", `tell application "Terminal" to do script ${JSON.stringify(script)}`], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
    return { ok: true, root };
  }
  const argv = ready ? [command] : ["bash"];
  const terminals = [
    ["x-terminal-emulator", ["-e", ...argv]],
    ["gnome-terminal", ["--working-directory", root, "--", ...argv]],
    ["konsole", ["--workdir", root, "-e", ...argv]],
    ["xterm", ["-e", ...argv]],
  ];
  for (const [bin, args] of terminals) {
    if (!hasBinary(bin, env)) continue;
    const child = spawn(bin, args, { cwd: root, env, detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return { ok: true, root };
  }
  return { error: "Could not open a terminal. Run node gui/server.mjs --cli from this folder." };
}

export function startCli(root, { inherit = false, env = process.env } = {}) {
  const remembered = rememberWorkspace(root);
  if (remembered.error) return remembered;
  const runEnv = withClaudePath(env);
  const command = resolveCommand("claude", runEnv);
  if (inherit) {
    if (!commandLooksInstalled(command)) {
      return {
        error: "Claude Code is not installed. Install it, then run node gui/server.mjs --cli again. The folder is already saved for Desk.",
        root,
      };
    }
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    // cmd.exe /s strips the outer quotes, so an unquoted shim path breaks at
    // the first space (C:\Users\John Smith\...\claude.cmd). Quote it when
    // shelling; quotes would be wrong for a direct spawn.
    const child = spawn(useShell && command.includes(" ") ? `"${command}"` : command, [], {
      cwd: root,
      env: runEnv,
      stdio: "inherit",
      shell: useShell,
    });
    return { ok: true, root, child };
  }
  return openCliTerminal(root, command, runEnv);
}
