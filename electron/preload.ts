import { contextBridge, ipcRenderer } from "electron";

type SecurityStatus = "active" | "monitoring" | "idle";

type ShellState = {
  appName: string;
  version: string;
  platform: string;
  secureDesktopMode: boolean;
  securityMetrics: Array<{
    label: string;
    value: string;
    status: SecurityStatus;
    detail: string;
  }>;
  transparencyLedger: string[];
};

const desktopApi = {
  getShellState: () => ipcRenderer.invoke("app:get-shell-state") as Promise<ShellState>
};

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
