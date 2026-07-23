const { contextBridge, ipcRenderer } = require("electron");

// App.tsx probes both `window.elelany` and `window.electronAPI`, so expose both.
const api = {
  isDesktop: true,
  platform: process.platform,

  // Screenshot tools used by the composer.
  startScreenSnip: () => ipcRenderer.invoke("elelany:start-screen-snip"),
  captureWindow: () => ipcRenderer.invoke("elelany:capture-window"),
  captureCurrentWindow: () => ipcRenderer.invoke("elelany:capture-window"),

  // UI zoom: "in" | "out" | "reset" | a numeric zoom factor.
  zoom: (action) => ipcRenderer.invoke("elelany:zoom", action),
  getZoom: () => ipcRenderer.invoke("elelany:get-zoom"),

  // Unread count shown on the dock (macOS) or taskbar/tray icon (Windows).
  // The renderer pre-renders the PNGs on a canvas, because Electron's
  // nativeImage cannot rasterize an SVG data URL — the earlier SVG approach
  // produced an empty image and nothing showed on Windows.
  setUnreadBadge: (count, images) => ipcRenderer.send("elelany:set-unread-badge", { count, ...(images || {}) }),

  // Version + updates.
  getVersion: () => ipcRenderer.invoke("elelany:get-version"),
  checkForUpdates: () => ipcRenderer.invoke("elelany:check-for-updates"),
  restartToUpdate: () => ipcRenderer.send("elelany:restart-to-update"),
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("elelany:update-status", listener);
    return () => ipcRenderer.removeListener("elelany:update-status", listener);
  },
};

contextBridge.exposeInMainWorld("elelany", api);
contextBridge.exposeInMainWorld("electronAPI", api);
