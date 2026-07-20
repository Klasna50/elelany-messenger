const path = require("path");
const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  screen,
  shell,
  Menu,
  dialog,
} = require("electron");
const { autoUpdater } = require("electron-updater");

const isDev = !app.isPackaged;

let mainWindow = null;
let pendingSnipImage = null;

// ---------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: "#ffffff",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev && process.env.ELECTRON_START_URL) {
    mainWindow.loadURL(process.env.ELECTRON_START_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());

  // External links (invite mailto:, docs, attachments) open in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------
// Screenshot: capture just this app window (no OS permission needed)
// ---------------------------------------------------------------------

ipcMain.handle("elelany:capture-window", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const image = await mainWindow.webContents.capturePage();
  return image.isEmpty() ? null : image.toDataURL();
});

// ---------------------------------------------------------------------
// Screenshot: native drag-to-select snipping across the screen
// ---------------------------------------------------------------------

ipcMain.handle("snip:get-image", () => pendingSnipImage);

function showSnipOverlay(display, imageDataUrl) {
  return new Promise((resolve) => {
    pendingSnipImage = imageDataUrl;

    const overlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: path.join(__dirname, "snip-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.loadFile(path.join(__dirname, "snip.html"));

    let settled = false;

    const cleanup = () => {
      ipcMain.removeListener("snip:done", onDone);
      ipcMain.removeListener("snip:cancel", onCancel);
      pendingSnipImage = null;
      if (!overlay.isDestroyed()) overlay.destroy();
    };

    const settle = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onDone = (_event, rect) => settle(rect);
    const onCancel = () => settle(null);

    ipcMain.on("snip:done", onDone);
    ipcMain.on("snip:cancel", onCancel);
    overlay.on("closed", () => settle(null));
  });
}

ipcMain.handle("elelany:start-screen-snip", async () => {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const scale = display.scaleFactor || 1;

  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.round(display.size.width * scale),
        height: Math.round(display.size.height * scale),
      },
    });
  } catch (error) {
    dialog.showErrorBox(
      "Screen capture unavailable",
      "Elelany could not access the screen.\n\nOn macOS grant permission under:\nSystem Settings -> Privacy & Security -> Screen Recording."
    );
    return null;
  }

  const source =
    sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];

  if (!source || source.thumbnail.isEmpty()) {
    dialog.showErrorBox(
      "Screen capture unavailable",
      "Elelany could not read the screen contents.\n\nOn macOS grant permission under:\nSystem Settings -> Privacy & Security -> Screen Recording, then restart Elelany."
    );
    return null;
  }

  const fullImage = source.thumbnail;

  // Hide our window so it is not captured inside the user's selection.
  const wasVisible = mainWindow && mainWindow.isVisible();
  if (wasVisible) mainWindow.hide();

  const rect = await showSnipOverlay(display, fullImage.toDataURL());

  if (wasVisible && mainWindow && !mainWindow.isDestroyed()) mainWindow.show();

  if (!rect || rect.width < 4 || rect.height < 4) return null;

  const cropped = fullImage.crop({
    x: Math.max(0, Math.round(rect.x * scale)),
    y: Math.max(0, Math.round(rect.y * scale)),
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  });

  return cropped.isEmpty() ? null : cropped.toDataURL();
});

// ---------------------------------------------------------------------
// Auto-update
// ---------------------------------------------------------------------

function sendUpdateStatus(status, payload = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("elelany:update-status", { status, ...payload });
  }
}

function initAutoUpdater() {
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => sendUpdateStatus("checking"));
  autoUpdater.on("update-available", (info) =>
    sendUpdateStatus("available", { version: info.version })
  );
  autoUpdater.on("update-not-available", () => sendUpdateStatus("up-to-date"));
  autoUpdater.on("download-progress", (progress) =>
    sendUpdateStatus("downloading", { percent: Math.round(progress.percent) })
  );
  autoUpdater.on("error", (error) =>
    sendUpdateStatus("error", { message: String(error && error.message ? error.message : error) })
  );

  autoUpdater.on("update-downloaded", async (info) => {
    sendUpdateStatus("ready", { version: info.version });

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `Elelany ${info.version} is ready to install.`,
      detail: "Restart to finish updating. Otherwise it installs next time you quit.",
    });

    if (response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall());
    }
  });

  autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);

  // Re-check every 6 hours for long-running sessions.
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  }, 6 * 60 * 60 * 1000);
}

ipcMain.handle("elelany:get-version", () => app.getVersion());
ipcMain.handle("elelany:check-for-updates", async () => {
  if (isDev) return { status: "dev" };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: "checked", version: result && result.updateInfo && result.updateInfo.version };
  } catch (error) {
    return { status: "error", message: String(error && error.message ? error.message : error) };
  }
});
ipcMain.on("elelany:restart-to-update", () => autoUpdater.quitAndInstall());

// ---------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------

// Only one running copy, so notifications and deep links stay consistent.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createMainWindow();
    buildAppMenu();
    initAutoUpdater();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

function buildAppMenu() {
  const isMac = process.platform === "darwin";

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              {
                label: "Check for Updates…",
                click: () => autoUpdater.checkForUpdatesAndNotify().catch(() => undefined),
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: isMac
        ? [{ role: "close" }]
        : [
            {
              label: "Check for Updates…",
              click: () => autoUpdater.checkForUpdatesAndNotify().catch(() => undefined),
            },
            { type: "separator" },
            { role: "quit" },
          ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }] },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
