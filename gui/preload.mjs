import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("deskApp", {
  openFolder: () => ipcRenderer.invoke("open-folder"),
  cloneWorkspace: () => ipcRenderer.invoke("clone-workspace"),
});
