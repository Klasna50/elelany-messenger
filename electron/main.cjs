const path = require("path");
const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  screen,
  shell,
  Menu,
  Tray,
  nativeImage,
  dialog,
} = require("electron");
const { autoUpdater } = require("electron-updater");

const isDev = !app.isPackaged;

let mainWindow = null;
let tray = null;
let pendingSnipImage = null;
app.isQuitting = false;

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
    // macOS: hide the OS title bar entirely and float the traffic lights in the
    // app's own top-left corner. A draggable strip is injected below so the
    // window can still be moved.
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 9 } }
      : {}),
    // Windows/Linux: no menu ribbon (File/Edit/Window). Settings live in the
    // in-app gear menu instead.
    autoHideMenuBar: process.platform !== "darwin",
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

  // The packaged web app is a centered card with page margins (great on the web,
  // but inside a desktop window it looks like a frame within a frame). Fill the
  // window edge-to-edge so it reads as a native app.
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.insertCSS(`
      html, body, #root { height: 100%; margin: 0; }
      .app-bg { padding: 0 !important; min-height: 100vh !important; }
      .app-bg > div {
        max-width: none !important;
        width: 100% !important;
        height: 100vh !important;
        border-radius: 0 !important;
        border: 0 !important;
        box-shadow: none !important;
      }
    `);

    // macOS only: reserve a slim strip at the top for the floating traffic
    // lights, and make that strip drag the window (there is no title bar).
    if (process.platform === "darwin") {
      mainWindow.webContents.insertCSS(`
        .app-bg { padding-top: 30px !important; }
        .app-bg > div { height: calc(100vh - 30px) !important; }
      `);

      mainWindow.webContents
        .executeJavaScript(
          `(function () {
             if (document.getElementById("elelany-drag-strip")) return;
             var strip = document.createElement("div");
             strip.id = "elelany-drag-strip";
             strip.style.cssText =
               "position:fixed;top:0;left:0;right:0;height:30px;z-index:2147483647;-webkit-app-region:drag;";
             document.body.appendChild(strip);
           })();`
        )
        .catch(() => undefined);
    }
  });

  // External links (invite mailto:, docs, attachments) open in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // Clicking the window's close (X) button hides the window and keeps the app
  // running in the background, so reopening is instant and the user stays
  // signed in. The app only truly closes when the user explicitly quits
  // (Cmd/Ctrl+Q, the app menu, or the tray "Quit" item).
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // macOS keeps a hidden app reachable through the Dock, so a tray isn't needed
  // there. On Windows/Linux a hidden window has no taskbar entry, so the tray is
  // the way back in.
  if (process.platform === "darwin") return;

  const image = nativeImage.createFromPath(path.join(__dirname, "tray.png"));
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip("Elelany");

  const showApp = () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
  };

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Elelany", click: showApp },
      { type: "separator" },
      {
        label: "Quit Elelany",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ])
  );

  tray.on("click", showApp);
  tray.on("double-click", showApp);
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

// ---------------------------------------------------------------------
// UI zoom (Cmd/Ctrl + scroll, and Cmd/Ctrl +/-/0)
// ---------------------------------------------------------------------

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.1;

ipcMain.handle("elelany:zoom", (_event, action) => {
  if (!mainWindow || mainWindow.isDestroyed()) return 1;

  const contents = mainWindow.webContents;
  const current = contents.getZoomFactor();
  let next = current;

  if (action === "in") next = current + ZOOM_STEP;
  else if (action === "out") next = current - ZOOM_STEP;
  else if (action === "reset") next = 1;
  else if (typeof action === "number") next = action;

  next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100));
  contents.setZoomFactor(next);
  return next;
});

ipcMain.handle("elelany:get-zoom", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return 1;
  return mainWindow.webContents.getZoomFactor();
});

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

    // macOS expects an application menu bar; Windows/Linux should not show a
    // ribbon, so we remove it entirely (text editing shortcuts still work, and
    // zoom/updates are handled in-app).
    if (process.platform === "darwin") {
      buildAppMenu();
    } else {
      Menu.setApplicationMenu(null);
    }

    createTray();
    initAutoUpdater();

    app.on("activate", () => {
      // Dock-icon click on macOS: reveal the SAME window instead of building a
      // new one. This keeps the renderer alive, so there's no reload and no
      // login-screen flash — the user is already signed in.
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createMainWindow();
      }
    });
  });

  // Real quit (Cmd/Ctrl+Q, menu, tray) — allow the window's close to proceed.
  app.on("before-quit", () => {
    app.isQuitting = true;
  });

  // Do NOT quit when the window is hidden. Closing the window backgrounds the
  // app (Dock on macOS, tray on Windows/Linux); it exits only via explicit quit.
  app.on("window-all-closed", () => {
    // Intentionally empty — the window is hidden on close, never destroyed.
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
