import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isJobSearchWorkspace } from "./claude.mjs";
import { createClaudeBootstrap } from "./claude-bootstrap.mjs";
import { createDeskRuntimeFactory } from "./desk-session.mjs";
import { startDesk } from "./server.mjs";
import { createClaudePty, defaultSpawnPty } from "./terminal/claude-pty.mjs";
import { switchToChat, switchToTerminal } from "./terminal/handoff.mjs";
import { applyFakeUpdateState, registerUpdateInstaller, setUpdateState } from "./update.mjs";
import {
  createWorkspace,
  defaultBrowseDir,
  existingWorkspaceHint,
  findExistingWorkspaces,
  NOT_A_WORKSPACE_TEXT,
  openFolderHint,
  readSharedWorkspace,
  rememberWorkspace,
  resolveWorkspace,
  sameWorkspace,
  startCli,
} from "./workspace.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

app.setName("Job Search Desk");
app.setAppUserModelId("com.ai-job-search.desk");

function statePath() {
  return join(app.getPath("userData"), "workspace.json");
}

function writeWorkspace(root) {
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(statePath(), JSON.stringify({ root }, null, 2));
  rememberWorkspace(root);
}

function wantsFirstRun() {
  return process.argv.includes("--first-run") || process.env.JOB_SEARCH_FORCE_FIRST_RUN === "1";
}

function sourceWorkspace() {
  if (wantsFirstRun()) return "";
  const here = join(HERE, "..");
  const root = resolveWorkspace({
    here: !app.isPackaged && isJobSearchWorkspace(here) ? here : "",
    extraPointers: [statePath()],
  });
  if (root && !readSharedWorkspace()) rememberWorkspace(root);
  return root;
}

let mainWindow = null;
let desk = null;
let activePty = null;
const claudeBootstrap = createClaudeBootstrap();

function opaqueId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(value) ? value : "";
}

function boundedText(value, max = 8192) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function boundedDim(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

async function openDesk(root) {
  if (desk && desk.workspace === root) {
    if (mainWindow) await mainWindow.loadURL(desk.href);
    return;
  }
  // Start the new desk before touching the old one or the pointer: if the new
  // root fails to serve, the running desk and the saved workspace stay valid.
  const next = await startDesk({
    root,
    openBrowser: false,
    allowRuntimeFailure: true,
    runtimeFactory: createDeskRuntimeFactory(),
  });
  desk?.stop();
  desk = next;
  writeWorkspace(root);
  process.env.JOB_SEARCH_ROOT = root;
  process.env.JOB_SEARCH_GUI_NO_BROWSER = "1";
  if (mainWindow) await mainWindow.loadURL(desk.href);
}

function preloadPath() {
  const packed = join(app.getAppPath(), "preload.cjs");
  const unpacked = packed.replace(/app\.asar(?=$|[\\/])/, "app.asar.unpacked");
  return existsSync(unpacked) ? unpacked : packed;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: "#100e0b",
    title: "Job Search Desk",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // Show something at once: a second click on the shortcut during a slow
  // start otherwise finds nothing on screen and looks like a failed launch.
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadFile(join(HERE, "public", "starting.html")).catch(() => {});
  // claude.ai logins and the Chrome Web Store need the user's real browser,
  // with its cookies and extension support, never a bare Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:") || (desk && url.startsWith(desk.href))) return;
    event.preventDefault();
    if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function startUpdates() {
  const current = app.getVersion();
  setUpdateState({ current, releasesUrl: "https://github.com/iLevyTate/ai-job-search/releases" });
  if (applyFakeUpdateState()) return;
  if (!app.isPackaged) {
    setUpdateState({ channel: "dev", current });
    return;
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    setUpdateState({ channel: "manual", current });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => setUpdateState({ channel: "checking", current }));
  autoUpdater.on("update-available", (info) => {
    setUpdateState({ channel: "available", current, version: info?.version || "" });
  });
  autoUpdater.on("update-not-available", () => setUpdateState({ channel: "idle", current, version: "" }));
  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({ channel: "downloaded", current, version: info?.version || "" });
  });
  autoUpdater.on("error", (err) => {
    setUpdateState({ channel: "error", current, error: err?.message || "Update check failed." });
  });
  registerUpdateInstaller(() => {
    autoUpdater.quitAndInstall();
  });
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setUpdateState({ channel: "error", current, error: err?.message || "Update check failed." });
  }
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

ipcMain.handle("list-workspaces", async () => {
  const current =
    readSharedWorkspace() ||
    resolveWorkspace({
      here: isJobSearchWorkspace(join(HERE, "..")) ? join(HERE, "..") : "",
      extraPointers: [statePath()],
    });
  const found = findExistingWorkspaces()
    .map((item) => ({ ...item, here: sameWorkspace(item.root, current) }))
    .sort((a, b) => Number(b.here) - Number(a.here));
  return {
    found,
    current,
    browseDir: defaultBrowseDir(),
    hint: existingWorkspaceHint(),
    openHint: openFolderHint(),
    platform: process.platform,
  };
});

ipcMain.handle("open-cli", async (_event, chosen) => {
  let root = typeof chosen === "string" ? chosen : "";
  if (!isJobSearchWorkspace(root)) {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: "Open job-search folder in Claude Code",
      defaultPath: defaultBrowseDir(),
      properties: ["openDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) return { error: "No folder selected." };
    root = picked.filePaths[0];
  }
  if (!isJobSearchWorkspace(root)) {
    return { error: NOT_A_WORKSPACE_TEXT };
  }
  const prep = claudeBootstrap.snapshot();
  if (prep.status === "installing") {
    return { error: "Claude Code is still installing. Wait for the message above to say it is ready, then try again." };
  }
  const started = startCli(root);
  if (started.error) return started;
  // The desk shows the same folder the terminal is using, instead of leaving
  // the person parked on the first-run page.
  try {
    await openDesk(root);
  } catch (err) {
    return { ...started, error: err.message || "The terminal opened, but the desk could not start in that folder." };
  }
  return started;
});

ipcMain.handle("open-workspace", async (_event, root) => {
  if (typeof root !== "string" || !isJobSearchWorkspace(root)) {
    return { error: NOT_A_WORKSPACE_TEXT };
  }
  try {
    await openDesk(root);
    return { ok: true };
  } catch (err) {
    return { error: err.message || "The desk could not start in that folder." };
  }
});

ipcMain.handle("open-folder", async () => {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: "Open job-search folder",
    defaultPath: defaultBrowseDir(),
    properties: ["openDirectory"],
  });
  if (picked.canceled || !picked.filePaths[0]) return { error: "No folder selected." };
  const root = picked.filePaths[0];
  if (!isJobSearchWorkspace(root)) {
    return { error: NOT_A_WORKSPACE_TEXT };
  }
  try {
    await openDesk(root);
    return { ok: true };
  } catch (err) {
    return { error: err.message || "The desk could not start in that folder." };
  }
});

ipcMain.handle("terminal-start", async (_event, payload = {}) => {
  if (!desk?.controllers) return { ok: false, error: "runtime-unavailable" };
  const cols = boundedDim(payload.cols, 80, 2, 500);
  const rows = boundedDim(payload.rows, 24, 2, 200);
  const expected = Number(payload.expectedControllerGeneration);
  return switchToTerminal({
    controllers: desk.controllers,
    expectedControllerGeneration: Number.isInteger(expected) ? expected : undefined,
    startPty: async (begun) => {
      if (!begun.sessionId) throw new Error("session-id-required");
      activePty?.dispose();
      const pty = createClaudePty({
        workspace: begun.workspace,
        sessionId: begun.sessionId,
        permissionMode: begun.permissionMode,
        spawnPty: defaultSpawnPty,
      });
      pty.start({ cols, rows });
      pty.onData((data) => mainWindow?.webContents.send("terminal-data", { terminalId: pty.id, data: boundedText(data) }));
      pty.onExit(async (info) => {
        const wasActive = activePty?.id === pty.id;
        if (wasActive) activePty = null;
        // Claude Code closing in the terminal must hand the conversation back
        // to Chat, or every later message is rejected until the app restarts.
        // A pty replaced by a newer one must not hand back the newer one's turn.
        let snapshot = null;
        const current = desk?.runtime?.snapshot?.();
        if (wasActive && desk?.controllers && current?.controller === "terminal") {
          const handoff = await switchToChat({
            controllers: desk.controllers,
            expectedControllerGeneration: current.controllerGeneration,
            terminalId: pty.id,
            disposePty: async () => {},
          }).catch(() => null);
          if (handoff?.ok) snapshot = handoff.snapshot;
        }
        mainWindow?.webContents.send("terminal-exit", { terminalId: pty.id, code: info.code, snapshot });
      });
      activePty = pty;
      return pty;
    },
  });
});

ipcMain.handle("terminal-write", async (_event, payload = {}) => {
  const terminalId = opaqueId(payload.terminalId);
  const data = boundedText(payload.data);
  if (!activePty || activePty.id !== terminalId) return { ok: false, error: "unknown-terminal" };
  activePty.write(data);
  return { ok: true };
});

ipcMain.handle("terminal-resize", async (_event, payload = {}) => {
  const terminalId = opaqueId(payload.terminalId);
  if (!activePty || activePty.id !== terminalId) return { ok: false, error: "unknown-terminal" };
  return { ok: true, ...activePty.resize(payload.cols, payload.rows) };
});

ipcMain.handle("terminal-dispose", async (_event, payload = {}) => {
  const terminalId = opaqueId(payload.terminalId);
  if (activePty && (!terminalId || activePty.id === terminalId)) {
    const snapshot = desk?.runtime?.snapshot?.();
    if (desk?.controllers && snapshot?.controller === "terminal") {
      const handoff = await switchToChat({
        controllers: desk.controllers,
        expectedControllerGeneration: snapshot.controllerGeneration,
        terminalId: activePty.id,
        disposePty: async () => activePty.dispose(),
      });
      activePty = null;
      // Return the post-handoff snapshot so the renderer's controllerGeneration
      // stays in sync; dropping it leaves every later message stale-controller.
      return handoff?.ok ? { ok: true, snapshot: handoff.snapshot } : { ok: true };
    }
    activePty.dispose();
    activePty = null;
  }
  return { ok: true };
});

ipcMain.handle("ensure-claude", async () => claudeBootstrap.ensure());

ipcMain.handle("clone-workspace", async () => {
  const destParent = await dialog.showOpenDialog(mainWindow, {
    title: "Choose where to create ai-job-search",
    defaultPath: defaultBrowseDir(),
    properties: ["openDirectory", "createDirectory"],
  });
  if (destParent.canceled || !destParent.filePaths[0]) {
    return { error: "No folder selected." };
  }
  const picked = destParent.filePaths[0];
  let dest = join(picked, "ai-job-search");
  // Someone who already has a Desk folder, or made an empty ai-job-search
  // folder themselves, will pick that folder; do not nest a copy inside it.
  if (isJobSearchWorkspace(picked)) dest = picked;
  else if (basename(picked) === "ai-job-search" && readdirSync(picked).length === 0) dest = picked;
  const created = await createWorkspace(dest);
  if (created.error) return created;
  try {
    await openDesk(dest);
    return { ok: true };
  } catch (err) {
    return { error: err.message || "The workspace was created but the desk could not start." };
  }
});

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusMainWindow();
  });

  app.whenReady().then(async () => {
    if (app.isPackaged) {
      try {
        process.chdir(app.getPath("userData"));
      } catch {
        // Shortcut launches sometimes start in System32. userData is enough.
      }
    }
    createWindow();
    startUpdates().catch(() => {});
    claudeBootstrap.ensure().catch(() => {});
    const root = sourceWorkspace();
    if (root) {
      try {
        await openDesk(root);
      } catch (err) {
        dialog.showErrorBox(
          "Job Search Desk",
          err.message || "The desk could not start. Close any other desk window and try again.",
        );
        await mainWindow.loadFile(join(HERE, "public", "first-run.html"));
      }
    } else {
      await mainWindow.loadFile(join(HERE, "public", "first-run.html"));
    }
  });
}

app.on("before-quit", () => {
  desk?.stop();
});

app.on("window-all-closed", () => {
  app.quit();
});
