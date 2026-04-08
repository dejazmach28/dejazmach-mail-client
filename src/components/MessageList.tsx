import { useMemo, useState } from "react";
import type { MailSummary } from "../../shared/contracts.js";
import type { WorkspaceSnapshot } from "../../shared/contracts.js";

type SortOrder = "newest" | "oldest" | "unread";

type MessageListProps = {
  accountId?: string;
  folderName: string;
  unreadCount?: number;
  isAutoSyncing?: boolean;
  isLoadingFolder?: boolean;
  messages: MailSummary[];
  searchQuery: string;
  selectedThreadId: string;
  selectedFolderName?: string;
  onOpenMessage: (messageId: string, threadId: string, accountId: string) => void;
  onSyncComplete: (workspace: WorkspaceSnapshot, folderName: string) => void;
  onSyncError: (message: string) => void;
  onSearchQueryChange: (value: string) => void;
  onShowSidebar?: () => void;
};

const getInitials = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "M";

/** Format a message timestamp: time if today, "Yesterday", or short date. */
const formatMessageTime = (raw: string): string => {
  if (!raw) return "";

  // Try to parse the raw time value as a date.
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return raw; // unparseable — show as-is

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const msgDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());

  if (msgDay.getTime() === today.getTime()) {
    return parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  if (msgDay.getTime() === yesterday.getTime()) {
    return "Yesterday";
  }

  const sevenDaysAgo = new Date(today.getTime() - 6 * 86_400_000);
  if (msgDay >= sevenDaysAgo) {
    return parsed.toLocaleDateString([], { weekday: "short" });
  }

  const currentYear = now.getFullYear();
  if (parsed.getFullYear() === currentYear) {
    return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  return parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "2-digit" });
};

type MessageRowProps = {
  isSelected: boolean;
  message: MailSummary;
  threadCount: number;
  onOpen: (messageId: string, threadId: string, accountId: string) => void;
};

function MessageRow({ isSelected, message, threadCount, onOpen }: MessageRowProps) {
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
          <span className="message-time">{formatMessageTime(message.time)}</span>
        </span>
        <span className="message-subject">
          {message.flagged ? <span className="message-flagged" aria-label="Flagged message">★</span> : null}
          <span className="message-subject-text">{message.subject}</span>
          {threadCount > 1 ? (
            <span className="thread-count-badge" aria-label={`${threadCount} messages in thread`}>{threadCount}</span>
          ) : null}
        </span>
        <span className="message-preview">{message.preview}</span>
      </span>
    </button>
  );
}

function SkeletonRow({ index }: { index: number }) {
  const widths = ["72%", "85%", "60%", "78%", "90%"];
  const previewWidths = ["45%", "65%", "50%", "70%", "55%"];
  return (
    <div className="message-row message-row-skeleton" aria-hidden="true">
      <span className="message-edge" />
      <span className="message-avatar skeleton-avatar" />
      <span className="message-copy">
        <span className="message-line">
          <span className="skeleton-bar" style={{ width: widths[index % widths.length], height: "13px" }} />
          <span className="skeleton-bar" style={{ width: "38px", height: "11px" }} />
        </span>
        <span className="skeleton-bar" style={{ width: "90%", height: "12px", marginTop: "6px" }} />
        <span className="skeleton-bar" style={{ width: previewWidths[index % previewWidths.length], height: "11px", marginTop: "4px" }} />
      </span>
    </div>
  );
}

export function MessageList({
  accountId,
  folderName,
  unreadCount,
  isAutoSyncing,
  isLoadingFolder,
  messages,
  searchQuery,
  selectedThreadId,
  selectedFolderName,
  onOpenMessage,
  onSyncComplete,
  onSyncError,
  onSearchQueryChange,
  onShowSidebar
}: MessageListProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  // Count how many messages share each threadId (for conversation badge)
  const threadCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const message of messages) {
      counts[message.threadId] = (counts[message.threadId] ?? 0) + 1;
    }
    return counts;
  }, [messages]);

  // Sort messages according to current sort order
  const sortedMessages = useMemo(() => {
    const copy = [...messages];
    if (sortOrder === "oldest") {
      copy.sort((a, b) => {
        const aTime = a.sentAt ? new Date(a.sentAt).getTime() : 0;
        const bTime = b.sentAt ? new Date(b.sentAt).getTime() : 0;
        return aTime - bTime;
      });
    } else if (sortOrder === "newest") {
      copy.sort((a, b) => {
        const aTime = a.sentAt ? new Date(a.sentAt).getTime() : 0;
        const bTime = b.sentAt ? new Date(b.sentAt).getTime() : 0;
        return bTime - aTime;
      });
    } else if (sortOrder === "unread") {
      copy.sort((a, b) => {
        if (a.unread === b.unread) {
          const aTime = a.sentAt ? new Date(a.sentAt).getTime() : 0;
          const bTime = b.sentAt ? new Date(b.sentAt).getTime() : 0;
          return bTime - aTime;
        }
        return a.unread ? -1 : 1;
      });
    }
    return copy;
  }, [messages, sortOrder]);

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

  const syncing = isAutoSyncing || isSyncing;

  return (
    <section className="message-pane">
      <header className="pane-header">
        <div className="pane-header-copy">
          {onShowSidebar ? (
            <button
              aria-label="Open menu"
              className="mobile-menu-button"
              onClick={onShowSidebar}
              type="button"
            >
              ☰
            </button>
          ) : null}
          <h2 className="pane-folder-name">{folderName || "Mailbox"}</h2>
          {typeof unreadCount === "number" && unreadCount > 0 ? (
            <span className="pane-unread-badge">{unreadCount}</span>
          ) : null}
        </div>
        <button
          aria-label={`Refresh ${folderName}`}
          className={syncing ? "refresh-button refresh-button-spinning" : "refresh-button"}
          disabled={syncing || !accountId || !folderName}
          onClick={() => {
            void handleSync();
          }}
          title="Sync folder"
          type="button"
        >
          <span className={syncing ? "refresh-icon refresh-icon-spinning" : "refresh-icon"} aria-hidden="true">
            ↻
          </span>
        </button>
      </header>

      <div className="search-shell">
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input
          className="search-input"
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search messages…"
          value={searchQuery}
        />
        {searchQuery ? (
          <button className="search-clear" onClick={() => onSearchQueryChange("")} type="button" aria-label="Clear search">
            ✕
          </button>
        ) : null}
      </div>

      {!isLoadingFolder && messages.length > 0 ? (
        <div className="message-pane-meta">
          <span>{messages.length} {messages.length === 1 ? "message" : "messages"}</span>
          <div className="sort-control">
            <select
              aria-label="Sort order"
              className="sort-select"
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
              value={sortOrder}
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="unread">Unread first</option>
            </select>
          </div>
        </div>
      ) : null}

      <div className="message-list" role="list">
        {isLoadingFolder ? (
          Array.from({ length: 7 }, (_, i) => <SkeletonRow index={i} key={i} />)
        ) : sortedMessages.length > 0 ? (
          sortedMessages.map((message) => (
            <MessageRow
              isSelected={message.threadId === selectedThreadId}
              key={message.id}
              message={message}
              threadCount={threadCounts[message.threadId] ?? 1}
              onOpen={onOpenMessage}
            />
          ))
        ) : (
          <div className="empty-panel">
            {syncing ? (
              <>
                <h3>Fetching messages…</h3>
                <p>Connecting to the mail server.</p>
              </>
            ) : searchQuery ? (
              <>
                <h3>No results.</h3>
                <p>No messages match <em>"{searchQuery}"</em>.</p>
              </>
            ) : selectedFolderName ? (
              <>
                <h3>Folder is empty.</h3>
                <p>No messages in {selectedFolderName} yet.</p>
              </>
            ) : (
              <>
                <h3>No account selected.</h3>
                <p>Verify an account to fetch folders from the server.</p>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
