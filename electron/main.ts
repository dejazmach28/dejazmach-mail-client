import { app } from "electron";
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-setuid-sandbox");
app.setName("DejAzmach");
import { BrowserWindow, Menu, Notification, dialog, ipcMain, session, shell, type MenuItemConstructorOptions } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLoadFailureUrl, createSplashScreenUrl } from "./loadScreens.js";
import { MailService } from "./mailService.js";
import { getEnvironment, isAllowedNavigation, isAllowedRendererRequest, isSafeExternalUrl } from "./shellPolicy.js";
import { createCipher } from "./vault.js";
import { createWindowStateStore } from "./windowState.js";
type BrowserWindowInstance = InstanceType<typeof BrowserWindow>;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const appUrl = devServerUrl ?? `file://${path.join(__dirname, "../../dist/index.html")}`;
const windowIconPath = path.join(__dirname, "../../assets/icons/256x256.png");

let mainWindow: BrowserWindowInstance | null = null;
let splashWindow: BrowserWindowInstance | null = null;
let mailService: MailService | null = null;
let windowStateStore: ReturnType<typeof createWindowStateStore> | null = null;
let backgroundSyncInterval: ReturnType<typeof setInterval> | null = null;
let initialBackgroundSyncTimeout: ReturnType<typeof setTimeout> | null = null;
let backgroundSyncRunning = false;

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
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [{ role: "about" }, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }]
    });
  }

  const windowSubmenu: MenuItemConstructorOptions[] =
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

  mainWindow.show();
  mainWindow.focus();
};

const pushWorkspaceSnapshot = (snapshot: ReturnType<MailService["getWorkspaceSnapshot"]>) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("workspace:updated", snapshot);
};

const updateUnreadBadge = (snapshot: ReturnType<MailService["getWorkspaceSnapshot"]>) => {
  const unreadCount = snapshot.messages.filter((message) => message.unread).length;

  if (process.platform === "darwin") {
    return;
  }

  if (process.platform === "win32" && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOverlayIcon(null, "");
  }

  app.setBadgeCount(unreadCount > 0 ? unreadCount : 0);
};

const showIncomingMessageNotifications = (
  accountAddress: string,
  newMessages: Array<{ sender: string; subject: string }>
) => {
  if (newMessages.length === 0) {
    return;
  }

  if (typeof Notification.isSupported === "function" && !Notification.isSupported()) {
    return;
  }

  try {
    if (newMessages.length > 2) {
      const notification = new Notification({
        title: "DejAzmach",
        body: `${newMessages.length} new messages in ${accountAddress}`,
        silent: false
      });

      notification.on("click", focusMainWindow);
      notification.show();
      return;
    }

    for (const message of newMessages) {
      const notification = new Notification({
        title: message.sender || accountAddress,
        body: message.subject || "(no subject)",
        silent: false
      });

      notification.on("click", focusMainWindow);
      notification.show();
    }
  } catch (error) {
    console.error("Notification delivery failed.", error);
  }
};

const isReauthMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).toLowerCase().includes("re-authentication");

const syncFolderAndBroadcast = async (
  input: { accountId: string; folderName: string; limit?: number },
  options?: { notify?: boolean; recordActivity?: boolean; broadcast?: boolean }
) => {
  const service = requireMailService();
  const syncAccount = service.listAccountsForSync().find((candidate) => candidate.id === input.accountId);
  if (syncAccount?.needsReauth) {
    throw new Error("Account needs re-authentication. Please re-enter your password.");
  }
  let result;
  try {
    result = await service.syncFolderWithResult(input, createWorkspaceContext(), {
      recordActivity: options?.recordActivity ?? true
    });
  } catch (error) {
    if (isReauthMessage(error)) {
      service.markNeedsReauth(input.accountId);
    }
    throw error;
  }
  const account = service.listAccountsForSync().find((candidate) => candidate.id === input.accountId);

  updateUnreadBadge(result.snapshot);
  if (options?.broadcast ?? true) {
    pushWorkspaceSnapshot(result.snapshot);
  }

  if (options?.notify !== false && result.newMessages.length > 0) {
    showIncomingMessageNotifications(account?.address ?? "Mailbox", result.newMessages);
  }

  return result;
};

const syncAllAccountInboxes = async () => {
  if (backgroundSyncRunning) {
    return;
  }

  backgroundSyncRunning = true;

  try {
    const service = requireMailService();
    const accounts = service.listAccountsForSync();
    let latestSnapshot = service.getWorkspaceSnapshot(createWorkspaceContext());
    let foundNewMessages = false;

    for (const account of accounts) {
      if (account.needsReauth) {
        continue;
      }

      try {
        const result = await syncFolderAndBroadcast(
          {
            accountId: account.id,
            folderName: "INBOX",
            limit: 20
          },
          {
            notify: true,
            recordActivity: false,
            broadcast: false
          }
        );
        latestSnapshot = result.snapshot;
        foundNewMessages = foundNewMessages || result.newMessages.length > 0;
      } catch (error) {
        if (isReauthMessage(error)) {
          service.markNeedsReauth(account.id);
          continue;
        }
        console.error(`Background inbox sync failed for ${account.address}.`, error);
      }
    }

    updateUnreadBadge(latestSnapshot);
    if (foundNewMessages) {
      pushWorkspaceSnapshot(latestSnapshot);
    }
  } finally {
    backgroundSyncRunning = false;
  }
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
    icon: windowIconPath,
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
    icon: windowIconPath,
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
  // The app name controls the Linux safeStorage namespace and the userData path.
  // Keeping it fixed at "DejAzmach" prevents dev and packaged builds from diverging.
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

  ipcMain.handle("app:get-signature", async (_event, accountId) => {
    try {
      return {
        ok: true as const,
        data: requireMailService().getSignature(accountId)
      };
    } catch (error) {
      return {
        ok: false as const,
        error: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle("app:set-signature", async (_event, input) => {
    try {
      return {
        ok: true as const,
        data: requireMailService().setSignature(input.accountId, input.body)
      };
    } catch (error) {
      return {
        ok: false as const,
        error: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle("app:reauth-account", async (_event, input) => {
    try {
      await requireMailService().reauthAccount(input.accountId, input.password, createWorkspaceContext());
      try {
        await syncAllAccountInboxes();
      } catch (error) {
        if (!isReauthMessage(error)) {
          throw error;
        }
      }

      return {
        ok: true as const,
        data: requireMailService().getWorkspaceSnapshot(createWorkspaceContext())
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
      const result = await syncFolderAndBroadcast(input, {
        notify: true,
        recordActivity: true
      });
      return {
        ok: true as const,
        data: result.snapshot
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

  ipcMain.handle("app:move-message", async (_event, input) => {
    try {
      return {
        ok: true as const,
        data: await requireMailService().moveMessage(input, createWorkspaceContext())
      };
    } catch (error) {
      return {
        ok: false as const,
        error: getErrorMessage(error),
        data: requireMailService().getWorkspaceSnapshot(createWorkspaceContext())
      };
    }
  });

  ipcMain.handle("app:archive-message", async (_event, input) => {
    try {
      return {
        ok: true as const,
        data: await requireMailService().archiveMessage(input, createWorkspaceContext())
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

  ipcMain.handle("app:mark-unread", async (_event, input) => {
    try {
      return {
        ok: true as const,
        data: await requireMailService().markUnread(input, createWorkspaceContext())
      };
    } catch (error) {
      return {
        ok: false as const,
        error: getErrorMessage(error),
        data: requireMailService().getWorkspaceSnapshot(createWorkspaceContext())
      };
    }
  });

  ipcMain.handle("app:toggle-flag", async (_event, input) => {
    try {
      return {
        ok: true as const,
        data: await requireMailService().toggleFlag(input, createWorkspaceContext())
      };
    } catch (error) {
      return {
        ok: false as const,
        error: getErrorMessage(error),
        data: requireMailService().getWorkspaceSnapshot(createWorkspaceContext())
      };
    }
  });

  ipcMain.handle("app:mark-spam", async (_event, input) => {
    try {
      return {
        ok: true as const,
        data: await requireMailService().markSpam(input, createWorkspaceContext())
      };
    } catch (error) {
      return {
        ok: false as const,
        error: getErrorMessage(error),
        data: requireMailService().getWorkspaceSnapshot(createWorkspaceContext())
      };
    }
  });

  ipcMain.handle("app:save-attachment", async (_event, input) => {
    const result = await dialog.showSaveDialog({
      defaultPath: input.filename
    });

    if (result.canceled || !result.filePath) {
      return {
        saved: false,
        path: null
      };
    }

    await fs.writeFile(result.filePath, Buffer.from(input.data, "base64"));
    return {
      saved: true,
      path: result.filePath
    };
  });

  if (process.platform === "win32") {
    app.setAppUserModelId("com.dejazmach.mail");
  }

  createSplashWindow();
  const window = createMainWindow();
  await loadApplicationUi(window);
  updateUnreadBadge(requireMailService().getWorkspaceSnapshot(createWorkspaceContext()));

  initialBackgroundSyncTimeout = setTimeout(() => {
    void syncAllAccountInboxes().catch((error) => {
      console.error("Initial background sync failed.", error);
    });
  }, 5000);

  backgroundSyncInterval = setInterval(() => {
    void syncAllAccountInboxes().catch((error) => {
      console.error("Background sync interval failed.", error);
    });
  }, 60000);

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
  if (initialBackgroundSyncTimeout) {
    clearTimeout(initialBackgroundSyncTimeout);
    initialBackgroundSyncTimeout = null;
  }

  if (backgroundSyncInterval) {
    clearInterval(backgroundSyncInterval);
    backgroundSyncInterval = null;
  }

  mailService?.close();
  mailService = null;
});
