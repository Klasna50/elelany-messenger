const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("snipAPI", {
  getImage: () => ipcRenderer.invoke("snip:get-image"),
  done: (rect) => ipcRenderer.send("snip:done", rect),
  cancel: () => ipcRenderer.send("snip:cancel"),
});
