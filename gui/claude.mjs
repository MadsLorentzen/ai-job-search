/**
 * Locate Claude Code, read subscription login state, and run the official
 * install / claude.ai login flows. Used by the localhost desk and the app.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { CLAUDE_INSTALL_PS1, CLAUDE_INSTALL_SH } from "./defaults.mjs";

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === "win32";

export function extraBinDirs(env = process.env) {
  const home = homedir();
  const dirs = [
    join(home, ".local", "bin"),
    join(home, ".claude", "local"),
    join(home, ".claude", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];
  if (env.LOCALAPPDATA) {
    dirs.push(join(env.LOCALAPPDATA, "claude"), join(env.LOCALAPPDATA, "Programs", "claude"));
  }
  return dirs;
}

export function withClaudePath(env = process.env) {
  const extra = extraBinDirs(env).join(delimiter);
  return { ...env, PATH: extra ? `${extra}${delimiter}${env.PATH || ""}` : env.PATH };
}

function candidateNames(name) {
  if (!IS_WIN) return [name];
  return [name, `${name}.cmd`, `${name}.exe`, `${name}.bat`];
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
      .find(Boolean);
    if (found) return found;
  } catch {
    // Packaged Electron often has a PATH that never saw the Claude installer.
  }

  for (const dir of extraBinDirs(merged)) {
    for (const file of candidateNames(name)) {
      const path = join(dir, file);
      if (existsSync(path)) return path;
    }
  }
  return name;
}

export function commandLooksInstalled(command) {
  if (!command || command === "claude") return false;
  return existsSync(command);
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
    const stdout = String(err.stdout || "");
    if (stdout.trim().startsWith("{")) {
      try {
        return { ...empty, installed: true, claude, ...parseAuthStatus(stdout) };
      } catch {
        // Fall through to a logged-out result.
      }
    }
    return { ...empty, installed: true, claude, error: err.message };
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
