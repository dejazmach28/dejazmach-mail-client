import type * as Electron from "electron";
import path from "node:path";
import { createLoadFailureUrl, createSplashScreenUrl } from "./loadScreens.js";
import { MailService } from "./mailService.js";
import { getEnvironment, isAllowedNavigation, isAllowedRendererRequest, isSafeExternalUrl } from "./shellPolicy.js";
import { createCipher } from "./vault.js";
import { createWindowStateStore } from "./windowState.js";
const { app, BrowserWindow, Menu, ipcMain, session } = require("electron/main") as typeof Electron;
const { shell } = require("electron/common") as typeof Electron;
type BrowserWindowInstance = InstanceType<typeof BrowserWindow>;
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const appUrl = devServerUrl ?? `file://${path.join(__dirname, "../../dist/index.html")}`;

let mainWindow: BrowserWindowInstance | null = null;
let splashWindow: BrowserWindowInstance | null = null;
let mailService: MailService | null = null;
let windowStateStore: ReturnType<typeof createWindowStateStore> | null = null;

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : "Unknown application error.");
const getEnvironmentState = () => getEnvironment(app.isPackaged, devServerUrl);

const requireMailService = () => {
  if (!mailService) {
    throw new Error("Mail service is not ready.");
  }

  return mailService;
};

const requireWindowStateStore = () => {
  if (!windowStateStore) {
    throw new Error("Window state store is not ready.");
  }

  return windowStateStore;
};

const getPolicyInput = () => ({
  appUrl,
  environment: getEnvironmentState()
});

const createWorkspaceContext = () => ({
  version: app.getVersion(),
  platform: process.platform,
  environment: getEnvironmentState(),
  packaged: app.isPackaged
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
  const isPackaged = app.isPackaged;
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
        ...(isPackaged ? [] : [{ type: "separator" as const }, { role: "reload" as const }, { role: "forceReload" as const }, { role: "toggleDevTools" as const }])
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
  const isPackaged = app.isPackaged;
  const bounds = requireWindowStateStore().load();

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
      sandbox: false,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
      devTools: !isPackaged
    }
  });

  mainWindow.once("ready-to-show", () => {
    closeSplashWindow();
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event: { preventDefault: () => void }, url: string) => {
    if (isAllowedNavigation(url, getPolicyInput())) {
      return;
    }

    event.preventDefault();
  });

  mainWindow.webContents.on("render-process-gone", async (_event: unknown, details: { reason: string }) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    await mainWindow.loadURL(
      createLoadFailureUrl(`The renderer exited unexpectedly: ${details.reason}. Restart the app after reviewing recent changes.`)
    );
    mainWindow.show();
  });

  mainWindow.webContents.on(
    "did-fail-load",
    async (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
      validatedUrl: string,
      isMainFrame: boolean
    ) => {
    if (!isMainFrame || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    await mainWindow.loadURL(
      createLoadFailureUrl(`Main frame load failed (${errorCode}): ${errorDescription}\nURL: ${validatedUrl}`)
    );
    mainWindow.show();
    closeSplashWindow();
    }
  );

  mainWindow.on("close", () => {
    if (mainWindow && !mainWindow.isMinimized() && !mainWindow.isMaximized()) {
      requireWindowStateStore().save(mainWindow);
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

const loadApplicationUi = async (window: BrowserWindowInstance) => {
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

if (process.platform === "linux") {
  // Older Linux GPU stacks, especially Intel Ivy Bridge, commonly hang or paint a black window in Electron.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");

  // AppImage mounts cannot preserve the setuid sandbox helper mode reliably.
  // Fall back to the namespace sandbox path instead of aborting at launch.
  if (process.env.APPIMAGE) {
    app.commandLine.appendSwitch("disable-setuid-sandbox");
  }
}

app.whenReady().then(async () => {
  windowStateStore = createWindowStateStore(app.getPath("userData"));
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

  ipcMain.handle("app:get-workspace-snapshot", () => requireMailService().getWorkspaceSnapshot(createWorkspaceContext()));

  ipcMain.handle("app:create-account", async (_event, input) => {
    try {
      return {
        ok: true as const,
        data: await requireMailService().createAccount(input, createWorkspaceContext())
      };
    } catch (error) {
      return {
        ok: false as const,
        error: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle("app:create-draft", async (_event, input) => {
    try {
      return {
        ok: true as const,
        data: await requireMailService().createDraft(input, createWorkspaceContext())
      };
    } catch (error) {
      return {
        ok: false as const,
        error: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle("app:verify-account", async (_event, accountId) => {
    try {
      return {
        ok: true as const,
        data: await requireMailService().verifyAccount(accountId, createWorkspaceContext())
      };
    } catch (error) {
      return {
        ok: false as const,
        error: getErrorMessage(error),
        data: requireMailService().getWorkspaceSnapshot(createWorkspaceContext())
      };
    }
  });

  ipcMain.handle("app:send-message", async (_event, input) => {
    try {
      return {
        ok: true as const,
        data: await requireMailService().sendMessage(input, createWorkspaceContext())
      };
    } catch (error) {
      return {
        ok: false as const,
        error: getErrorMessage(error),
        data: requireMailService().getWorkspaceSnapshot(createWorkspaceContext())
      };
    }
  });

  ipcMain.handle("app:fetch-message-body", async (_event, input) => {
    try {
      return {
        ok: true as const,
        data: await requireMailService().fetchMessageBody(input, createWorkspaceContext())
      };
    } catch (error) {
      return {
        ok: false as const,
        error: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle("app:sync-folder", async (_event, input) => {
    try {
      return {
        ok: true as const,
        data: await requireMailService().syncFolder(input, createWorkspaceContext())
      };
    } catch (error) {
      return {
        ok: false as const,
        error: getErrorMessage(error),
        data: requireMailService().getWorkspaceSnapshot(createWorkspaceContext())
      };
    }
  });

  ipcMain.handle("app:delete-message", async (_event, input) => {
    try {
      return {
        ok: true as const,
        data: await requireMailService().deleteMessage(input, createWorkspaceContext())
      };
    } catch (error) {
      return {
        ok: false as const,
        error: getErrorMessage(error),
        data: requireMailService().getWorkspaceSnapshot(createWorkspaceContext())
      };
    }
  });

  ipcMain.handle("app:mark-read", async (_event, input) => {
    try {
      return {
        ok: true as const,
        data: await requireMailService().markRead(input, createWorkspaceContext())
      };
    } catch (error) {
      return {
        ok: false as const,
        error: getErrorMessage(error),
        data: requireMailService().getWorkspaceSnapshot(createWorkspaceContext())
      };
    }
  });

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
