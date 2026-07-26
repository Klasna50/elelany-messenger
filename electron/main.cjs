const path = require("path");
const fs = require("fs");
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
// Remember the window size/position across launches (and app updates).
// The state file lives in userData, which survives an update, so the app
// reopens at the size the user last set instead of the default.
// ---------------------------------------------------------------------

const DEFAULT_WINDOW = { width: 1440, height: 920 };
const MIN_WINDOW = { width: 940, height: 620 };
let lastNormalBounds = null;
let saveWindowTimer = null;

function windowStateFile() {
  return path.join(app.getPath("userData"), "window-state.json");
}

// True if enough of the window would land on a connected display to be usable
// (guards against a saved position on a monitor that's no longer attached).
function boundsOnScreen(bounds) {
  if (!bounds || typeof bounds.x !== "number" || typeof bounds.y !== "number") return false;
  return screen.getAllDisplays().some((display) => {
    const a = display.workArea;
    return (
      bounds.x < a.x + a.width - 40 &&
      bounds.x + bounds.width > a.x + 40 &&
      bounds.y < a.y + a.height - 40 &&
      bounds.y + bounds.height > a.y + 20
    );
  });
}

function loadWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(windowStateFile(), "utf8"));
    const width = Math.max(MIN_WINDOW.width, Math.round(Number(saved.width) || DEFAULT_WINDOW.width));
    const height = Math.max(MIN_WINDOW.height, Math.round(Number(saved.height) || DEFAULT_WINDOW.height));
    const state = { width, height, isMaximized: Boolean(saved.isMaximized) };
    if (boundsOnScreen({ x: saved.x, y: saved.y, width, height })) {
      state.x = Math.round(saved.x);
      state.y = Math.round(saved.y);
    }
    return state;
  } catch {
    return { ...DEFAULT_WINDOW, isMaximized: false };
  }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  // Only capture the "restored" bounds while the window is in its normal state,
  // so maximizing doesn't overwrite the size to restore to.
  if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
    lastNormalBounds = win.getBounds();
  }
  const base = lastNormalBounds || DEFAULT_WINDOW;
  const state = {
    x: base.x,
    y: base.y,
    width: base.width,
    height: base.height,
    isMaximized: win.isMaximized(),
  };
  try {
    fs.writeFileSync(windowStateFile(), JSON.stringify(state));
  } catch {
    // Best effort — a missing size memory is not worth crashing over.
  }
}

function scheduleWindowStateSave() {
  if (saveWindowTimer) clearTimeout(saveWindowTimer);
  saveWindowTimer = setTimeout(() => saveWindowState(mainWindow), 400);
}

// ---------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------

function createMainWindow() {
  const winState = loadWindowState();
  mainWindow = new BrowserWindow({
    width: winState.width,
    height: winState.height,
    ...(typeof winState.x === "number" && typeof winState.y === "number"
      ? { x: winState.x, y: winState.y }
      : {}),
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
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
      // Keep the renderer running at full speed while the window is hidden or
      // minimized, so incoming realtime messages are processed and the unread
      // badge updates in the background (Chromium freezes background pages by
      // default, which is why the dock/taskbar count never appeared).
      backgroundThrottling: false,
      // Spell-check the composer; suggestions appear in the right-click menu.
      spellcheck: true,
    },
  });

  // macOS uses the native spell-checker (its own languages); on Windows/Linux
  // Electron's Hunspell needs a language set, so seed it from the app locale.
  if (process.platform !== "darwin") {
    try {
      const locale = app.getLocale() || "en-US";
      mainWindow.webContents.session.setSpellCheckerLanguages([locale.startsWith("en") ? "en-US" : locale]);
    } catch {
      // A missing dictionary just means no squiggles; not fatal.
    }
  }

  // Restore the maximized state and seed the "restore" bounds from the saved
  // size (getBounds() would report the maximized size once maximized).
  lastNormalBounds = {
    x: winState.x,
    y: winState.y,
    width: winState.width,
    height: winState.height,
  };
  if (winState.isMaximized) mainWindow.maximize();

  // Persist size/position whenever it changes, so the last layout is always on
  // disk (userData) and survives quitting and app updates.
  mainWindow.on("resize", scheduleWindowStateSave);
  mainWindow.on("move", scheduleWindowStateSave);
  mainWindow.on("maximize", () => saveWindowState(mainWindow));
  mainWindow.on("unmaximize", () => saveWindowState(mainWindow));

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

    // macOS only: make room for the floating traffic lights INSIDE the app's
    // own surface (the white card fills the window and the clearance is its own
    // top area) rather than as a separate gradient band above it, so the window
    // reads as one compact piece. A draggable strip over that area moves the
    // window since there is no title bar.
    if (process.platform === "darwin") {
      mainWindow.webContents.insertCSS(`
        .app-bg > div { height: 100vh !important; }
        /* Put the traffic-light clearance inside EACH panel so the strip takes
           that panel's own colour — grey above the sidebar, white above the
           chat/composer — with no seam. */
        .app-bg > div > aside,
        .app-bg > div > main { padding-top: 30px !important; }
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

  // Electron shows no context menu by default, so right-clicking the composer
  // did nothing. Build the usual Cut/Copy/Paste menu for editable fields, Copy
  // for any selected text, and — when right-clicking a misspelled word —
  // spelling corrections at the top.
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const { editFlags, isEditable, selectionText, misspelledWord, dictionarySuggestions } = params;
    const hasSelection = Boolean(selectionText && selectionText.trim());
    const hasMisspelling = Boolean(misspelledWord);
    if (!isEditable && !hasSelection) return;

    const template = [];

    // Spelling suggestions for a misspelled word, then "Add to dictionary".
    if (hasMisspelling) {
      if (dictionarySuggestions && dictionarySuggestions.length) {
        for (const suggestion of dictionarySuggestions) {
          template.push({
            label: suggestion,
            click: () => mainWindow.webContents.replaceMisspelling(suggestion),
          });
        }
      } else {
        template.push({ label: "No suggestions", enabled: false });
      }
      template.push({ type: "separator" });
      template.push({
        label: "Add to dictionary",
        click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(misspelledWord),
      });
      template.push({ type: "separator" });
    }

    if (isEditable) {
      template.push(
        { label: "Cut", role: "cut", enabled: editFlags.canCut },
        { label: "Copy", role: "copy", enabled: editFlags.canCopy },
        { label: "Paste", role: "paste", enabled: editFlags.canPaste },
        { type: "separator" },
        { label: "Select All", role: "selectAll", enabled: editFlags.canSelectAll }
      );
    } else {
      template.push(
        { label: "Copy", role: "copy", enabled: editFlags.canCopy },
        { type: "separator" },
        { label: "Select All", role: "selectAll", enabled: editFlags.canSelectAll }
      );
    }

    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  // Clicking the window's close (X) button hides the window and keeps the app
  // running in the background, so reopening is instant and the user stays
  // signed in. The app only truly closes when the user explicitly quits
  // (Cmd/Ctrl+Q, the app menu, or the tray "Quit" item).
  mainWindow.on("close", (event) => {
    saveWindowState(mainWindow);
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// Every "bring the app back" path goes through here: dock click, tray click,
// tray menu, and relaunch from a pinned taskbar icon. A hidden window needs
// show(); a minimized one needs restore(); both then need focus().
function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  // macOS keeps a hidden app reachable through the Dock, so a tray isn't needed
  // there. On Windows/Linux a hidden window has no taskbar entry, so the tray is
  // the way back in.
  if (process.platform === "darwin") return;

  const image = nativeImage.createFromPath(path.join(__dirname, "tray.png"));
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip("Elelany");

  const showApp = () => revealMainWindow();

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
// Unread badge on the app icon
// ---------------------------------------------------------------------

// The unread badge. macOS/Linux get a native dock/launcher count. Windows has
// neither, so the renderer draws PNGs on a canvas (Electron's nativeImage
// cannot rasterize SVG) and we hang them on the taskbar button and, when the
// window is hidden to the tray, on the tray icon.
function setUnreadBadge(payload) {
  const data = payload && typeof payload === "object" ? payload : { count: payload };
  const count = Math.max(0, Math.floor(Number(data.count) || 0));

  // macOS/Linux: native dock/launcher badge. Works in every state, including
  // while the window is hidden.
  if (typeof app.setBadgeCount === "function") {
    try {
      app.setBadgeCount(count);
    } catch {
      // Some Linux desktops have no Unity launcher; a missing badge is harmless.
    }
  }

  if (process.platform === "win32" && mainWindow && !mainWindow.isDestroyed()) {
    let overlay = null;
    if (count > 0 && data.overlayDataUrl) {
      const img = nativeImage.createFromDataURL(data.overlayDataUrl);
      if (!img.isEmpty()) overlay = img;
    }
    mainWindow.setOverlayIcon(overlay, count > 0 ? `${count} unread message${count === 1 ? "" : "s"}` : "");
  }

  // The taskbar button vanishes when the window is hidden on Windows, so the
  // tray icon carries the badge in the background.
  if (tray) {
    if (process.platform === "win32" && count > 0 && data.trayDataUrl) {
      const trayImg = nativeImage.createFromDataURL(data.trayDataUrl);
      if (!trayImg.isEmpty()) tray.setImage(trayImg);
    } else {
      const base = nativeImage.createFromPath(path.join(__dirname, "tray.png"));
      if (!base.isEmpty()) tray.setImage(base);
    }
    tray.setToolTip(count > 0 ? `Elelany — ${count} unread` : "Elelany");
  }
}

ipcMain.on("elelany:set-unread-badge", (_event, payload) => setUnreadBadge(payload));

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

// Installing an update requires the app to actually quit. Our close handler
// normally cancels that (it hides the window to keep running in the
// background), so we must flag a real quit and tear the tray down first,
// otherwise "Restart" appears to do nothing and the update never installs.
function restartToUpdate() {
  app.isQuitting = true;

  if (tray) {
    tray.destroy();
    tray = null;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners("close");
  }

  // isSilent = false, isForceRunAfter = true -> relaunch once installed.
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
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
      restartToUpdate();
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
ipcMain.on("elelany:restart-to-update", () => restartToUpdate());

// ---------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------

// Only one running copy, so notifications and deep links stay consistent.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Launching the app again (pinned taskbar icon, Start menu, desktop shortcut)
  // lands here instead of starting a second copy. The window is HIDDEN after a
  // close, not minimized, so it must be show()n — restore()/focus() alone leave
  // a hidden window hidden, which is why the taskbar icon appeared to do nothing.
  app.on("second-instance", () => {
    revealMainWindow();
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
      revealMainWindow();
    });
  });

  // Real quit (Cmd/Ctrl+Q, menu, tray) — allow the window's close to proceed.
  app.on("before-quit", () => {
    app.isQuitting = true;
    saveWindowState(mainWindow);
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
