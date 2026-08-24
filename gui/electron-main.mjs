import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isJobSearchWorkspace } from "./claude.mjs";
import { startDesk } from "./server.mjs";
import { createWorkspace } from "./workspace.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

app.setName("Job Search Desk");
app.setAppUserModelId("com.ai-job-search.desk");

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
    width: 1280,
    height: 860,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: "#100e0b",
    title: "Job Search Desk",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(HERE, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
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
    defaultPath: join(homedir(), "Documents"),
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
