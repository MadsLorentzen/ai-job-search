/**
 * Locate Claude Code, read subscription login state, and run the official
 * install / claude.ai login flows. Used by the localhost desk and the app.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { CLAUDE_INSTALL_PS1, CLAUDE_INSTALL_SH, DESK_SESSION_NAME } from "./defaults.mjs";

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === "win32";

export function extraBinDirs(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const dirs = [
    join(home, ".local", "bin"),
    join(home, ".claude", "local"),
    join(home, ".claude", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];
  if (env.LOCALAPPDATA) {
    dirs.push(
      join(env.LOCALAPPDATA, "claude"),
      join(env.LOCALAPPDATA, "Programs", "claude"),
      join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"),
    );
  }
  // Windows npm global shims (`claude.cmd`) live here. Packaged Electron often
  // has a PATH that never saw that folder, so `where claude` misses it.
  if (env.APPDATA) {
    dirs.push(join(env.APPDATA, "npm"));
  }
  if (env.npm_config_prefix) dirs.push(env.npm_config_prefix);
  if (IS_WIN) {
    const systemRoot = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
    dirs.push(join(systemRoot, "system32"));
  }
  return dirs;
}

let persistedWindowsPath;

function windowsPersistedPath() {
  if (!IS_WIN) return "";
  if (persistedWindowsPath !== undefined) return persistedWindowsPath;
  persistedWindowsPath = "";
  try {
    persistedWindowsPath = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "[Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')",
      ],
      { encoding: "utf8", timeout: 8000, windowsHide: true },
    ).trim();
  } catch {
    persistedWindowsPath = "";
  }
  return persistedWindowsPath;
}

export function withClaudePath(env = process.env) {
  const extras = extraBinDirs(env);
  const persisted = env === process.env ? windowsPersistedPath() : "";
  const parts = [...extras, persisted, env.PATH || ""].filter(Boolean);
  return { ...env, PATH: parts.join(delimiter) };
}

function candidateNames(name) {
  if (!IS_WIN) return [name];
  // The extensionless npm shim is a Unix script. Spawn it and Windows returns -4058.
  return [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name];
}

function windowsRunnable(found) {
  if (!IS_WIN || /\.(cmd|exe|bat)$/i.test(found)) return found;
  for (const ext of [".cmd", ".exe", ".bat"]) {
    if (existsSync(`${found}${ext}`)) return `${found}${ext}`;
  }
  return found;
}

export function resolveCommand(name, env = process.env) {
  if (env.CLAUDE_BIN && name === "claude") return env.CLAUDE_BIN;

  const merged = withClaudePath(env);
  try {
    const found = execFileSync(IS_WIN ? "where" : "which", [name], {
      encoding: "utf8",
      env: merged,
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const preferred = found.find((line) => /\.(cmd|exe|bat)$/i.test(line)) || found[0];
    if (preferred) return windowsRunnable(preferred);
  } catch {
    // Packaged Electron often has a PATH that never saw the Claude installer.
  }

  for (const dir of extraBinDirs(merged)) {
    for (const file of candidateNames(name)) {
      const path = join(dir, file);
      if (existsSync(path)) return windowsRunnable(path);
    }
  }
  return name;
}

export function commandLooksInstalled(command) {
  if (!command || command === "claude") return false;
  return existsSync(command);
}

export function needsInstall(health) {
  return Boolean(health) && health.installed === false && !health.error;
}

export function needsLogin(health) {
  return Boolean(health?.installed && health.loggedIn === false && !health.error);
}

export function parseAuthStatus(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!data || typeof data !== "object") {
    throw new SyntaxError("auth status was not an object");
  }
  return {
    loggedIn: Boolean(data.loggedIn),
    authMethod: typeof data.authMethod === "string" ? data.authMethod : "",
    email: typeof data.email === "string" ? data.email : "",
    subscriptionType: typeof data.subscriptionType === "string" ? data.subscriptionType : "",
    orgName: typeof data.orgName === "string" ? data.orgName : "",
    usesClaudeAi: data.authMethod === "claude.ai",
  };
}

export function extractHttpsUrls(text) {
  if (!text) return [];
  const found = [];
  for (const match of text.matchAll(/https:\/\/[^\s)\]>'"]+/g)) {
    const url = match[0].replace(/[.,;]+$/, "");
    if (!found.includes(url)) found.push(url);
  }
  return found;
}

export function loginNeedsCode(text) {
  return /paste code here/i.test(text || "");
}

export function loginSucceeded(text) {
  return /login successful/i.test(text || "");
}

export function isJobSearchWorkspace(root) {
  return Boolean(
    root && existsSync(join(root, "gui", "server.mjs")) && existsSync(join(root, "AGENTS.md")),
  );
}

function useShell(command) {
  return IS_WIN && /\.(cmd|bat)$/i.test(command);
}

export function chromeEnabled(env = process.env) {
  return env.JOB_SEARCH_CLAUDE_CHROME !== "0";
}

export function deskSessionPath(root) {
  return join(root, ".claude", "desk-session.json");
}

export function loadDeskSession(root) {
  try {
    const data = JSON.parse(readFileSync(deskSessionPath(root), "utf8"));
    return typeof data.sessionId === "string" && data.sessionId ? data.sessionId : null;
  } catch {
    return null;
  }
}

export function saveDeskSession(root, id) {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(deskSessionPath(root), `${JSON.stringify({ sessionId: id, name: DESK_SESSION_NAME }, null, 2)}\n`);
}

export function buildClaudeArgs(prompt, { sessionId = null, chrome = chromeEnabled(), name = DESK_SESSION_NAME } = {}) {
  const args = [];
  if (chrome) args.push("--chrome");
  args.push(
    "--dangerously-skip-permissions",
    "--name",
    name,
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  );
  if (sessionId) args.push("--resume", sessionId);
  return args;
}

export function spawnClaude(args, { cwd, env, detached = false } = {}) {
  const command = resolveCommand("claude", env);
  return spawn(command, args, {
    cwd,
    env: withClaudePath(env || process.env),
    shell: useShell(command),
    windowsHide: true,
    detached,
  });
}

export async function getClaudeHealth(cwd) {
  const claude = resolveCommand("claude");
  const installed = commandLooksInstalled(claude);
  const empty = {
    installed,
    claude: installed ? claude : "",
    loggedIn: false,
    authMethod: "",
    email: "",
    subscriptionType: "",
    orgName: "",
    usesClaudeAi: false,
  };
  if (!installed) return empty;

  try {
    const { stdout } = await execFileAsync(claude, ["auth", "status", "--json"], {
      cwd,
      env: withClaudePath(),
      timeout: 20000,
      windowsHide: true,
      shell: useShell(claude),
    });
    return { ...empty, installed: true, claude, ...parseAuthStatus(stdout) };
  } catch (err) {
    for (const raw of [String(err.stdout || ""), String(err.stderr || "")]) {
      if (raw.trim().startsWith("{")) {
        try {
          return { ...empty, installed: true, claude, ...parseAuthStatus(raw) };
        } catch {
          // Try the other stream before treating status as unknown.
        }
      }
    }
    return {
      ...empty,
      installed: true,
      claude,
      loggedIn: null,
      error: err.message,
    };
  }
}

export function spawnOfficialInstall() {
  if (IS_WIN) {
    return spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `irm ${CLAUDE_INSTALL_PS1} | iex`],
      { windowsHide: true, env: process.env },
    );
  }
  return spawn("bash", ["-lc", `curl -fsSL ${CLAUDE_INSTALL_SH} | bash`], { env: process.env });
}

export function spawnSubscriptionLogin({ cwd, email } = {}) {
  const args = ["auth", "login", "--claudeai"];
  if (email) args.push("--email", email);
  const child = spawnClaude(args, { cwd });
  child.stdin?.write("\n");
  return child;
}
