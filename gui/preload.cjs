const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("deskApp", {
  listWorkspaces: () => ipcRenderer.invoke("list-workspaces"),
  openWorkspace: (root) => ipcRenderer.invoke("open-workspace", root),
  openFolder: () => ipcRenderer.invoke("open-folder"),
  cloneWorkspace: () => ipcRenderer.invoke("clone-workspace"),
  openCli: (root) => ipcRenderer.invoke("open-cli", root),
});
