import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isJobSearchWorkspace } from "./claude.mjs";
import { TEMPLATE_REPO } from "./defaults.mjs";
import { startDesk } from "./server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function statePath() {
  return join(app.getPath("userData"), "workspace.json");
}

function readStoredWorkspace() {
  try {
    const data = JSON.parse(readFileSync(statePath(), "utf8"));
    if (isJobSearchWorkspace(data.root)) return data.root;
  } catch {
    // First launch, or the last folder was moved.
  }
  return "";
}

function writeWorkspace(root) {
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(statePath(), JSON.stringify({ root }, null, 2));
}

function sourceWorkspace() {
  if (!app.isPackaged && isJobSearchWorkspace(join(HERE, ".."))) {
    return join(HERE, "..");
  }
  return readStoredWorkspace();
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: "#14110e",
    title: "Job Search Desk",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(HERE, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("open-folder", async () => {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: "Open job-search folder",
    properties: ["openDirectory"],
  });
  if (picked.canceled || !picked.filePaths[0]) return { error: "No folder selected." };
  const root = picked.filePaths[0];
  if (!isJobSearchWorkspace(root)) {
    return { error: "That folder is not a job-search repo. It needs AGENTS.md and gui/." };
  }
  await openDesk(root);
  return { ok: true };
});

ipcMain.handle("clone-workspace", async () => {
  const destParent = await dialog.showOpenDialog(mainWindow, {
    title: "Choose where to create ai-job-search",
    defaultPath: join(homedir(), "Documents"),
    properties: ["openDirectory", "createDirectory"],
  });
  if (destParent.canceled || !destParent.filePaths[0]) {
    return { error: "No folder selected." };
  }
  const dest = join(destParent.filePaths[0], "ai-job-search");
  if (existsSync(dest)) {
    if (isJobSearchWorkspace(dest)) {
      await openDesk(dest);
      return { ok: true };
    }
    return { error: `${dest} already exists and is not a job-search repo.` };
  }

  const cloned = await new Promise((resolve) => {
    const child = spawn("git", ["clone", "--depth", "1", TEMPLATE_REPO, dest], { windowsHide: true });
    let err = "";
    child.stderr?.on("data", (chunk) => {
      err += chunk.toString("utf8");
    });
    child.on("error", (error) => resolve({ error: error.message }));
    child.on("close", (code) => {
      if (code) resolve({ error: err.trim() || `git clone exited ${code}` });
      else resolve({ ok: true });
    });
  });
  if (cloned.error) return cloned;
  if (!isJobSearchWorkspace(dest)) {
    return { error: "Clone finished but the folder looks incomplete." };
  }
  await openDesk(dest);
  return { ok: true };
});

app.whenReady().then(async () => {
  createWindow();
  const root = sourceWorkspace();
  if (root) await openDesk(root);
  else await mainWindow.loadFile(join(HERE, "public", "first-run.html"));
});

app.on("before-quit", () => {
  desk?.stop();
});

app.on("window-all-closed", () => {
  app.quit();
});
