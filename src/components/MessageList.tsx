import { useEffect, useMemo, useState, type MouseEvent } from "react";
import type { MailSummary, WorkspaceSnapshot } from "../../shared/contracts.js";
import { getAvatarColor } from "../utils/avatarColor.js";

type SortOrder = "newest" | "oldest" | "unread";

type ContextSelection = {
  x: number;
  y: number;
  messageIds: string[];
} | null;

type BatchActionOutcome = {
  failed: string[];
  succeeded: string[];
};

type MessageListProps = {
  accountId?: string;
  folderName: string;
  folderDisplayName: string;
  unreadCount?: number;
  isAutoSyncing?: boolean;
  isLoadingFolder?: boolean;
  messages: MailSummary[];
  searchQuery: string;
  selectedThreadId: string;
  selectedFolderName?: string;
  onArchiveSelection: (messageIds: string[]) => Promise<BatchActionOutcome>;
  onDeleteSelection: (messageIds: string[]) => Promise<BatchActionOutcome>;
  onMarkSpamSelection: (messageIds: string[]) => Promise<BatchActionOutcome>;
  onMarkUnreadSelection: (messageIds: string[]) => Promise<BatchActionOutcome>;
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

const formatMessageTime = (raw: string): string => {
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const msgDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  if (msgDay.getTime() === today.getTime()) {
    return parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (msgDay.getTime() === yesterday.getTime()) return "Yesterday";
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

const getDateBucket = (raw: string | undefined): string => {
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const msgDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  if (msgDay.getTime() === today.getTime()) return "Today";
  if (msgDay.getTime() === yesterday.getTime()) return "Yesterday";
  const sevenDaysAgo = new Date(today.getTime() - 6 * 86_400_000);
  if (msgDay >= sevenDaysAgo) {
    return parsed.toLocaleDateString([], { weekday: "long" });
  }
  return parsed.toLocaleDateString([], { month: "long", day: "numeric" });
};

type MessageRowProps = {
  isBatchSelected: boolean;
  isSelected: boolean;
  message: MailSummary;
  threadCount: number;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, message: MailSummary) => void;
  onOpen: (event: MouseEvent<HTMLDivElement>, message: MailSummary) => void;
  onToggleSelection: (messageId: string) => void;
};

function MessageRow({
  isBatchSelected,
  isSelected,
  message,
  threadCount,
  onContextMenu,
  onOpen,
  onToggleSelection
}: MessageRowProps) {
  const rowClassName = [
    "message-row",
    isSelected ? "message-row-selected" : "",
    isBatchSelected ? "message-row-batch-selected" : "",
    message.unread ? "message-row-unread" : "message-row-read"
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rowClassName}
      onClick={(event) => onOpen(event, message)}
      onContextMenu={(event) => onContextMenu(event, message)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(event as unknown as MouseEvent<HTMLDivElement>, message);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span className="message-edge">
        {message.unread ? <span className="message-unread-dot" aria-hidden="true" /> : null}
      </span>
      <button
        aria-label={isBatchSelected ? "Deselect message" : "Select message"}
        className={isBatchSelected ? "message-select-toggle message-select-toggle-active" : "message-select-toggle"}
        onClick={(event) => {
          event.stopPropagation();
          onToggleSelection(message.id);
        }}
        type="button"
      >
        {isBatchSelected ? "✓" : ""}
      </button>
      <span
        className="message-avatar"
        style={{ background: getAvatarColor(message.sender) }}
      >
        {getInitials(message.sender)}
      </span>
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
        <span className="message-preview">{message.preview || "No preview available."}</span>
      </span>
    </div>
  );
}

function SkeletonRow({ index }: { index: number }) {
  const widths = ["72%", "85%", "60%", "78%", "90%"];
  const previewWidths = ["45%", "65%", "50%", "70%", "55%"];
  return (
    <div className="message-row message-row-skeleton" aria-hidden="true">
      <span className="message-edge" />
      <span className="message-select-toggle" />
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
  folderDisplayName,
  unreadCount,
  isAutoSyncing,
  isLoadingFolder,
  messages,
  searchQuery,
  selectedThreadId,
  selectedFolderName,
  onArchiveSelection,
  onDeleteSelection,
  onMarkSpamSelection,
  onMarkUnreadSelection,
  onOpenMessage,
  onSyncComplete,
  onSyncError,
  onSearchQueryChange,
  onShowSidebar
}: MessageListProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [contextSelection, setContextSelection] = useState<ContextSelection>(null);

  useEffect(() => {
    setSelectedMessageIds((current) => current.filter((messageId) => messages.some((message) => message.id === messageId)));
  }, [messages]);

  useEffect(() => {
    if (!contextSelection) return;
    const closeMenu = () => setContextSelection(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, [contextSelection]);

  const threadCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const message of messages) {
      counts[message.threadId] = (counts[message.threadId] ?? 0) + 1;
    }
    return counts;
  }, [messages]);

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
    } else {
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

  const groupedMessages = useMemo(() => {
    const groups: Array<{ bucket: string; messages: MailSummary[] }> = [];
    for (const message of sortedMessages) {
      const bucket = getDateBucket(message.sentAt);
      const last = groups[groups.length - 1];
      if (last && last.bucket === bucket) {
        last.messages.push(message);
      } else {
        groups.push({ bucket, messages: [message] });
      }
    }
    return groups;
  }, [sortedMessages]);

  const handleSync = async () => {
    if (!window.desktopApi) {
      onSyncError("Folder sync requires the Electron desktop shell.");
      return;
    }
    if (!accountId || !folderName) return;
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

  const toggleSelectedMessage = (messageId: string) => {
    setSelectedMessageIds((current) =>
      current.includes(messageId) ? current.filter((entry) => entry !== messageId) : [...current, messageId]
    );
  };

  const handleRowOpen = (event: MouseEvent<HTMLDivElement>, message: MailSummary) => {
    if (event.metaKey || event.ctrlKey) {
      toggleSelectedMessage(message.id);
      return;
    }
    if (selectedMessageIds.length > 0 && !selectedMessageIds.includes(message.id)) {
      setSelectedMessageIds([message.id]);
      return;
    }
    setSelectedMessageIds([]);
    onOpenMessage(message.id, message.threadId, message.accountId);
  };

  const handleRowContextMenu = (event: MouseEvent<HTMLDivElement>, message: MailSummary) => {
    event.preventDefault();
    const nextSelection = selectedMessageIds.includes(message.id) ? selectedMessageIds : [message.id];
    setSelectedMessageIds(nextSelection);
    setContextSelection({
      x: event.clientX,
      y: event.clientY,
      messageIds: nextSelection
    });
  };

  const runSelectionAction = async (handler: (messageIds: string[]) => Promise<BatchActionOutcome>) => {
    if (!contextSelection) return;
    const nextIds = contextSelection.messageIds;
    setContextSelection(null);
    const outcome = await handler(nextIds);
    setSelectedMessageIds(outcome.failed);
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
          <h2 className="pane-folder-name">{folderDisplayName || "Mailbox"}</h2>
          {typeof unreadCount === "number" && unreadCount > 0 ? (
            <span className="pane-unread-badge">{unreadCount}</span>
          ) : null}
          {syncing ? <span className="pane-syncing-indicator">Syncing…</span> : null}
        </div>
        <button
          aria-label={`Refresh ${folderDisplayName || folderName}`}
          className={syncing ? "refresh-button refresh-button-spinning" : "refresh-button"}
          disabled={syncing || !accountId || !folderName || folderDisplayName === "Search results"}
          onClick={() => { void handleSync(); }}
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
          <button aria-label="Clear search" className="search-clear" onClick={() => onSearchQueryChange("")} type="button">
            ✕
          </button>
        ) : null}
      </div>

      {!isLoadingFolder && messages.length > 0 ? (
        <div className="message-pane-meta">
          <span>{messages.length} {messages.length === 1 ? "message" : "messages"}</span>
          <div className="message-pane-meta-actions">
            {selectedMessageIds.length > 0 ? (
              <button
                className="message-selection-chip"
                onClick={() => setSelectedMessageIds([])}
                type="button"
              >
                {selectedMessageIds.length} selected · Clear
              </button>
            ) : null}
            <div className="sort-control">
              <select
                aria-label="Sort order"
                className="sort-select"
                onChange={(event) => setSortOrder(event.target.value as SortOrder)}
                value={sortOrder}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="unread">Unread first</option>
              </select>
            </div>
          </div>
        </div>
      ) : null}

      <div className="message-list" role="list">
        {isLoadingFolder ? (
          Array.from({ length: 7 }, (_, index) => <SkeletonRow index={index} key={index} />)
        ) : sortedMessages.length > 0 ? (
          groupedMessages.map(({ bucket, messages: groupMsgs }) => (
            <div key={bucket} role="group" aria-label={bucket}>
              {bucket ? <div className="message-group-header" aria-hidden="true">{bucket}</div> : null}
              {groupMsgs.map((message) => (
                <MessageRow
                  isBatchSelected={selectedMessageIds.includes(message.id)}
                  isSelected={message.threadId === selectedThreadId}
                  key={message.id}
                  message={message}
                  onContextMenu={handleRowContextMenu}
                  onOpen={handleRowOpen}
                  onToggleSelection={toggleSelectedMessage}
                  threadCount={threadCounts[message.threadId] ?? 1}
                />
              ))}
            </div>
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

      {contextSelection ? (
        <div
          className="message-context-menu"
          role="menu"
          style={{ left: contextSelection.x, top: contextSelection.y }}
        >
          <button onClick={() => { void runSelectionAction(onArchiveSelection); }} role="menuitem" type="button">
            Archive
          </button>
          <button onClick={() => { void runSelectionAction(onMarkUnreadSelection); }} role="menuitem" type="button">
            Mark unread
          </button>
          <button onClick={() => { void runSelectionAction(onMarkSpamSelection); }} role="menuitem" type="button">
            Mark spam
          </button>
          <div className="more-menu-divider" />
          <button className="message-context-menu-danger" onClick={() => { void runSelectionAction(onDeleteSelection); }} role="menuitem" type="button">
            Delete
          </button>
        </div>
      ) : null}
    </section>
  );
}
