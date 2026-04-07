import { useState } from "react";
import type { MailSummary } from "../../shared/contracts.js";
import type { WorkspaceSnapshot } from "../../shared/contracts.js";

type MessageListProps = {
  accountId?: string;
  folderName: string;
  unreadCount?: number;
  isAutoSyncing?: boolean;
  messages: MailSummary[];
  searchQuery: string;
  selectedThreadId: string;
  selectedFolderName?: string;
  onOpenMessage: (messageId: string, threadId: string, accountId: string) => void;
  onSyncComplete: (workspace: WorkspaceSnapshot, folderName: string) => void;
  onSyncError: (message: string) => void;
  onSearchQueryChange: (value: string) => void;
};

const getInitials = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "M";

type MessageRowProps = {
  isSelected: boolean;
  message: MailSummary;
  onOpen: (messageId: string, threadId: string, accountId: string) => void;
};

function MessageRow({ isSelected, message, onOpen }: MessageRowProps) {
  const rowClassName = [
    "message-row",
    isSelected ? "message-row-selected" : "",
    message.unread ? "message-row-unread" : "message-row-read"
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={rowClassName} onClick={() => onOpen(message.id, message.threadId, message.accountId)} type="button">
      <span className="message-edge">
        {message.unread ? <span className="message-unread-dot" aria-hidden="true" /> : null}
      </span>
      <span className="message-avatar">{getInitials(message.sender)}</span>
      <span className="message-copy">
        <span className="message-line">
          <strong className="message-sender">{message.sender}</strong>
          <span>{message.time}</span>
        </span>
        <span className="message-subject">
          {message.flagged ? <span className="message-flagged" aria-label="Flagged message">★</span> : null}
          <span className="message-subject-text">{message.subject}</span>
        </span>
        <span className="message-preview">{message.preview}</span>
      </span>
    </button>
  );
}

export function MessageList({
  accountId,
  folderName,
  unreadCount,
  isAutoSyncing,
  messages,
  searchQuery,
  selectedThreadId,
  selectedFolderName,
  onOpenMessage,
  onSyncComplete,
  onSyncError,
  onSearchQueryChange
}: MessageListProps) {
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    if (!window.desktopApi) {
      onSyncError("Folder sync requires the Electron desktop shell.");
      return;
    }

    if (!accountId || !folderName) {
      return;
    }

    setIsSyncing(true);

    try {
      const result = await window.desktopApi.syncFolder({ accountId, folderName });
      if (result.data) {
        onSyncComplete(result.data, folderName);
      }
      if (!result.ok) {
        throw new Error(result.error);
      }
    } catch (error) {
      onSyncError(error instanceof Error ? error.message : "Folder sync failed.");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <section className="message-pane">
      <header className="pane-header">
        <div>
          <span className="eyebrow">Mailbox</span>
          <h2>{folderName}</h2>
          {isAutoSyncing || isSyncing ? <span className="pane-sync-indicator">Syncing...</span> : null}
        </div>
        <div className="pane-actions">
          <button
            aria-label={`Refresh ${folderName}`}
            className="refresh-button"
            disabled={isSyncing || !accountId || !folderName}
            onClick={() => {
              void handleSync();
            }}
            type="button"
          >
            <span className={isSyncing ? "refresh-icon refresh-icon-spinning" : "refresh-icon"} aria-hidden="true">
              ↻
            </span>
          </button>
        </div>
      </header>

      <label className="search-shell">
        <span className="search-label">Search</span>
        <input
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search messages..."
          value={searchQuery}
        />
      </label>

      <div className="message-pane-meta">
        <span>{messages.length} messages</span>
        {typeof unreadCount === "number" ? <span>{unreadCount} unread</span> : null}
      </div>

      <div className="message-list">
        {messages.length > 0 ? (
          messages.map((message) => (
            <MessageRow
              isSelected={message.threadId === selectedThreadId}
              key={message.id}
              message={message}
              onOpen={onOpenMessage}
            />
          ))
        ) : (
          <div className="empty-panel">
            <h3>No messages found.</h3>
            <p>
              {selectedFolderName
                ? "This folder is empty, or the current search does not match any message."
                : "Verify the account to fetch folders from the server."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
