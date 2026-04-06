import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../shared/contracts.js";

const desktopApi = {
  getWorkspaceSnapshot: () => ipcRenderer.invoke("app:get-workspace-snapshot")
} satisfies DesktopApi;

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
