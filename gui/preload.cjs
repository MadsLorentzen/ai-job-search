const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("deskApp", {
  listWorkspaces: () => ipcRenderer.invoke("list-workspaces"),
  openWorkspace: (root) => ipcRenderer.invoke("open-workspace", root),
  openFolder: () => ipcRenderer.invoke("open-folder"),
  cloneWorkspace: () => ipcRenderer.invoke("clone-workspace"),
  openCli: (root) => ipcRenderer.invoke("open-cli", root),
  terminal: {
    start: (payload) => ipcRenderer.invoke("terminal-start", payload),
    write: (payload) => ipcRenderer.invoke("terminal-write", payload),
    resize: (payload) => ipcRenderer.invoke("terminal-resize", payload),
    dispose: (payload) => ipcRenderer.invoke("terminal-dispose", payload),
    onData: (listener) => subscribe("terminal-data", listener),
    onExit: (listener) => subscribe("terminal-exit", listener),
  },
});
