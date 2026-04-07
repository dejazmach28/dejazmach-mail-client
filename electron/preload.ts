import electron from "electron";
import type { DesktopApi } from "../shared/contracts.js";
const { contextBridge, ipcRenderer } = electron;

const desktopApi = {
  getWorkspaceSnapshot: () => ipcRenderer.invoke("app:get-workspace-snapshot"),
  createAccount: (input) => ipcRenderer.invoke("app:create-account", input),
  createDraft: (input) => ipcRenderer.invoke("app:create-draft", input),
  verifyAccount: (accountId) => ipcRenderer.invoke("app:verify-account", accountId),
  sendMessage: (input) => ipcRenderer.invoke("app:send-message", input),
  fetchMessageBody: (input) => ipcRenderer.invoke("app:fetch-message-body", input),
  syncFolder: (input) => ipcRenderer.invoke("app:sync-folder", input),
  deleteMessage: (input) => ipcRenderer.invoke("app:delete-message", input),
  markRead: (input) => ipcRenderer.invoke("app:mark-read", input),
  markUnread: (input) => ipcRenderer.invoke("app:mark-unread", input),
  toggleFlag: (input) => ipcRenderer.invoke("app:toggle-flag", input),
  markSpam: (input) => ipcRenderer.invoke("app:mark-spam", input),
  moveMessage: (input) => ipcRenderer.invoke("app:move-message", input),
  archiveMessage: (input) => ipcRenderer.invoke("app:archive-message", input),
  getSignature: (accountId) => ipcRenderer.invoke("app:get-signature", accountId),
  setSignature: (input) => ipcRenderer.invoke("app:set-signature", input),
  reauthAccount: (input) => ipcRenderer.invoke("app:reauth-account", input),
  updateAccountDisplayName: (input) => ipcRenderer.invoke("app:update-account-display-name", input),
  updateAccountImap: (input) => ipcRenderer.invoke("app:update-account-imap", input),
  updateAccountSmtp: (input) => ipcRenderer.invoke("app:update-account-smtp", input),
  deleteAccount: (accountId) => ipcRenderer.invoke("app:delete-account", accountId),
  getPreferences: () => ipcRenderer.invoke("app:get-preferences"),
  setPreferences: (input) => ipcRenderer.invoke("app:set-preferences", input),
  saveAttachment: (input) => ipcRenderer.invoke("app:save-attachment", input),
  onWorkspaceUpdate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof callback>[0]) => callback(snapshot);
    ipcRenderer.on("workspace:updated", listener);
    return () => {
      ipcRenderer.off("workspace:updated", listener);
    };
  }
} satisfies DesktopApi;

contextBridge.exposeInMainWorld("desktopApi", Object.freeze(desktopApi));
