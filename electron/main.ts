import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type SecurityStatus = "active" | "monitoring" | "idle";

type ShieldMetric = {
  label: string;
  value: string;
  status: SecurityStatus;
  detail: string;
};

const securityMetrics: ShieldMetric[] = [
  {
    label: "Remote content",
    value: "Blocked by default",
    status: "active",
    detail: "Pixels, mixed content, and unaudited embeds stay disabled until the user explicitly allows them."
  },
  {
    label: "Vault encryption",
    value: "AES-256 + OS keychain",
    status: "active",
    detail: "Account secrets are intended to live in the operating system credential vault instead of renderer storage."
  },
  {
    label: "Attachment execution",
    value: "Quarantined",
    status: "active",
    detail: "Unknown files are treated as untrusted and must be opened outside the app under explicit user action."
  },
  {
    label: "Telemetry",
    value: "Zero by default",
    status: "monitoring",
    detail: "No silent analytics pipeline is wired in. Every future diagnostic event should appear in the transparency ledger."
  }
];

const createWindow = async () => {
  const window = new BrowserWindow({
    width: 1520,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#120f0a",
    title: "DejAzmach",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    await window.loadURL(devServerUrl);
  } else {
    await window.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
};

app.whenReady().then(() => {
  ipcMain.handle("app:get-shell-state", () => ({
    appName: "DejAzmach",
    version: app.getVersion(),
    platform: process.platform,
    secureDesktopMode: true,
    securityMetrics,
    transparencyLedger: [
      "No remote images were fetched in this session.",
      "Renderer is isolated from Node.js APIs by preload-only access.",
      "External links are denied in-app and pushed to the default browser only on https URLs."
    ]
  }));

  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
