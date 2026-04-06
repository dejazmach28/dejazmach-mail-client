import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../shared/contracts.js";

const desktopApi = {
  getWorkspaceSnapshot: () => ipcRenderer.invoke("app:get-workspace-snapshot"),
  createAccount: (input) => ipcRenderer.invoke("app:create-account", input),
  createDraft: (input) => ipcRenderer.invoke("app:create-draft", input),
  verifyAccount: (accountId) => ipcRenderer.invoke("app:verify-account", accountId),
  sendMessage: (input) => ipcRenderer.invoke("app:send-message", input),
  fetchMessageBody: (input) => ipcRenderer.invoke("app:fetch-message-body", input),
  syncFolder: (input) => ipcRenderer.invoke("app:sync-folder", input),
  deleteMessage: (input) => ipcRenderer.invoke("app:delete-message", input),
  markRead: (input) => ipcRenderer.invoke("app:mark-read", input)
} satisfies DesktopApi;

contextBridge.exposeInMainWorld("desktopApi", Object.freeze(desktopApi));
