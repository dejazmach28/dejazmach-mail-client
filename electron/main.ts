import { app, BrowserWindow, Menu, ipcMain, session, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLoadFailureUrl, createSplashScreenUrl } from "./loadScreens.js";
import { MailService } from "./mailService.js";
import { getEnvironment, isAllowedNavigation, isAllowedRendererRequest, isSafeExternalUrl } from "./shellPolicy.js";
import { createCipher } from "./vault.js";
import { createWindowStateStore } from "./windowState.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const appUrl = devServerUrl ?? `file://${path.join(__dirname, "../../dist/index.html")}`;
const environment = getEnvironment(app.isPackaged, devServerUrl);
const windowStateStore = createWindowStateStore(app.getPath("userData"));

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let mailService: MailService | null = null;

const requireMailService = () => {
  if (!mailService) {
    throw new Error("Mail service is not ready.");
  }

  return mailService;
};

const getPolicyInput = () => ({
  appUrl,
  environment
});

const configureSessionPolicy = () => {
  const defaultSession = session.defaultSession;

  defaultSession.setPermissionCheckHandler(() => false);
  defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  defaultSession.setDevicePermissionHandler(() => false);
  defaultSession.setDisplayMediaRequestHandler((_request, callback) => callback({ video: undefined, audio: undefined }));
  defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRendererRequest(details.url, getPolicyInput()) });
  });
  defaultSession.on("will-download", (event) => {
    event.preventDefault();
  });
};

const buildApplicationMenu = () => {
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [{ role: "about" }, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }]
    });
  }

  const windowSubmenu: Electron.MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
      : [{ role: "minimize" }, { role: "close" }];

  template.push(
    {
      label: "File",
      submenu: [{ role: "close" }, { role: process.platform === "darwin" ? "hide" : "quit" }]
    },
    {
      label: "Edit",
      submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }]
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ type: "separator" as const }, { role: "reload" as const }, { role: "forceReload" as const }, { role: "toggleDevTools" as const }])
      ]
    },
    {
      label: "Window",
      submenu: windowSubmenu
    }
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const focusMainWindow = () => {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
};

const createSplashWindow = () => {
  splashWindow = new BrowserWindow({
    width: 520,
    height: 360,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    frame: false,
    autoHideMenuBar: true,
    show: true,
    backgroundColor: "#110f0c",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false
    }
  });

  void splashWindow.loadURL(createSplashScreenUrl());
};

const closeSplashWindow = () => {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }

  splashWindow = null;
};

const createMainWindow = () => {
  const bounds = windowStateStore.load();

  mainWindow = new BrowserWindow({
    show: false,
    width: bounds.width,
    height: bounds.height,
    ...(typeof bounds.x === "number" ? { x: bounds.x } : {}),
    ...(typeof bounds.y === "number" ? { y: bounds.y } : {}),
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#120f0a",
    title: "DejAzmach",
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
      devTools: !app.isPackaged
    }
  });

  mainWindow.once("ready-to-show", () => {
    closeSplashWindow();
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigation(url, getPolicyInput())) {
      return;
    }

    event.preventDefault();
  });

  mainWindow.webContents.on("render-process-gone", async (_event, details) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    await mainWindow.loadURL(
      createLoadFailureUrl(`The renderer exited unexpectedly: ${details.reason}. Restart the app after reviewing recent changes.`)
    );
    mainWindow.show();
  });

  mainWindow.webContents.on("did-fail-load", async (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    await mainWindow.loadURL(
      createLoadFailureUrl(`Main frame load failed (${errorCode}): ${errorDescription}\nURL: ${validatedUrl}`)
    );
    mainWindow.show();
    closeSplashWindow();
  });

  mainWindow.on("close", () => {
    if (mainWindow && !mainWindow.isMinimized() && !mainWindow.isMaximized()) {
      windowStateStore.save(mainWindow);
    }
  });

  mainWindow.on("unresponsive", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    await mainWindow.loadURL(
      createLoadFailureUrl("The renderer became unresponsive. DejAzmach kept the secure shell alive instead of continuing in an unknown state.")
    );
    mainWindow.show();
  });

  return mainWindow;
};

const loadApplicationUi = async (window: BrowserWindow) => {
  try {
    if (devServerUrl) {
      await window.loadURL(devServerUrl);
    } else {
      await window.loadFile(path.join(__dirname, "../../dist/index.html"));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown renderer startup failure.";
    await window.loadURL(createLoadFailureUrl(message));
    window.show();
    closeSplashWindow();
  }
};

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

app.whenReady().then(async () => {
  buildApplicationMenu();
  configureSessionPolicy();
  mailService = new MailService({
    userDataPath: app.getPath("userData"),
    cipher: createCipher()
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
  });

  ipcMain.handle("app:get-workspace-snapshot", () =>
    requireMailService().getWorkspaceSnapshot({
      version: app.getVersion(),
      platform: process.platform,
      environment,
      packaged: app.isPackaged
    })
  );

  ipcMain.handle("app:create-account", (_event, input) =>
    requireMailService().createAccount(input, {
      version: app.getVersion(),
      platform: process.platform,
      environment,
      packaged: app.isPackaged
    })
  );

  ipcMain.handle("app:create-draft", (_event, input) =>
    requireMailService().createDraft(input, {
      version: app.getVersion(),
      platform: process.platform,
      environment,
      packaged: app.isPackaged
    })
  );

  ipcMain.handle("app:verify-account", (_event, accountId) =>
    requireMailService().verifyAccount(accountId, {
      version: app.getVersion(),
      platform: process.platform,
      environment,
      packaged: app.isPackaged
    })
  );

  ipcMain.handle("app:send-message", (_event, input) =>
    requireMailService().sendMessage(input, {
      version: app.getVersion(),
      platform: process.platform,
      environment,
      packaged: app.isPackaged
    })
  );

  if (process.platform === "win32") {
    app.setAppUserModelId("com.dejazmach.mail");
  }

  createSplashWindow();
  const window = createMainWindow();
  await loadApplicationUi(window);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplashWindow();
      const nextWindow = createMainWindow();
      void loadApplicationUi(nextWindow);
    } else {
      focusMainWindow();
    }
  });
});

app.on("second-instance", () => {
  focusMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  mailService?.close();
  mailService = null;
});
