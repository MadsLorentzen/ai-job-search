import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isJobSearchWorkspace } from "./claude.mjs";
import { startDesk } from "./server.mjs";
import {
  createWorkspace,
  defaultBrowseDir,
  existingWorkspaceHint,
  findExistingWorkspaces,
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

async function openDesk(root) {
  writeWorkspace(root);
  process.env.JOB_SEARCH_ROOT = root;
  process.env.JOB_SEARCH_GUI_NO_BROWSER = "1";
  if (!desk) {
    desk = await startDesk({ root, openBrowser: false });
  }
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
  mainWindow.once("ready-to-show", () => mainWindow.show());
  // claude.ai logins and the Chrome Web Store need the user's real browser,
  // with its cookies and extension support, never a bare Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
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
    return { error: "That folder is not a job-search repo. It needs AGENTS.md and gui/." };
  }
  writeWorkspace(root);
  return startCli(root);
});

ipcMain.handle("open-workspace", async (_event, root) => {
  if (typeof root !== "string" || !isJobSearchWorkspace(root)) {
    return { error: "That folder is not a job-search repo. It needs AGENTS.md and gui/." };
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
    return { error: "That folder is not a job-search repo. It needs AGENTS.md and gui/." };
  }
  try {
    await openDesk(root);
    return { ok: true };
  } catch (err) {
    return { error: err.message || "The desk could not start in that folder." };
  }
});

ipcMain.handle("clone-workspace", async () => {
  const destParent = await dialog.showOpenDialog(mainWindow, {
    title: "Choose where to create ai-job-search",
    defaultPath: defaultBrowseDir(),
    properties: ["openDirectory", "createDirectory"],
  });
  if (destParent.canceled || !destParent.filePaths[0]) {
    return { error: "No folder selected." };
  }
  const dest = join(destParent.filePaths[0], "ai-job-search");
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
