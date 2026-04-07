import { useMemo, useState } from "react";
import type { Attachment, MailSummary, ThreadDetail } from "../../shared/contracts.js";

type MessageReaderProps = {
  thread?: ThreadDetail;
  readerMessage?: MailSummary;
  folders: Array<{ id: string; name: string }>;
  loadingMessageBodyId: string | null;
  onArchive: () => void;
  onDelete: () => void;
  onMarkSpam: () => void;
  onMarkUnread: () => void;
  onMove: (targetFolderName: string) => void;
  onToggleFlag: (flagged: boolean) => void;
  onReply: () => void;
  onForward: () => void;
};

const trustClassMap = {
  trusted: "mini-pill mini-pill-neutral",
  encrypted: "mini-pill mini-pill-success",
  review: "mini-pill mini-pill-warning"
} as const;

const getInitials = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "M";

const sanitizeHtml = (html: string): string =>
  html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/javascript:/gi, "");

const formatAttachmentSize = (size: number) => {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(size / 1024))} KB`;
};

const handleAttachmentSave = async (attachment: Attachment) => {
  if (!window.desktopApi) {
    return;
  }

  await window.desktopApi.saveAttachment({
    filename: attachment.filename,
    data: attachment.data,
    mimeType: attachment.mimeType
  });
};

export function MessageReader({
  thread,
  readerMessage,
  folders,
  loadingMessageBodyId,
  onArchive,
  onDelete,
  onMarkSpam,
  onMarkUnread,
  onMove,
  onToggleFlag,
  onReply,
  onForward
}: MessageReaderProps) {
  const [messageViewMode, setMessageViewMode] = useState<Record<string, "html" | "plain">>({});
  const [htmlLoadingMessageId, setHtmlLoadingMessageId] = useState<string | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const handleShowHtml = (messageId: string) => {
    setHtmlLoadingMessageId(messageId);
    window.setTimeout(() => {
      setMessageViewMode((currentMode) => ({
        ...currentMode,
        [messageId]: "html"
      }));
      setHtmlLoadingMessageId((currentId) => (currentId === messageId ? null : currentId));
    }, 120);
  };

  if (!thread) {
    return (
      <article className="reader-card">
        <div className="empty-panel empty-panel-reader">
          <h3>No conversation selected.</h3>
          <p>Select a message from the center column or start a new draft.</p>
        </div>
      </article>
    );
  }

  const readerHtmlChoices = useMemo(
    () =>
      thread.messages.reduce<Record<string, string>>((accumulator, message) => {
        if (message.html) {
          accumulator[message.id] = sanitizeHtml(message.html);
        }
        return accumulator;
      }, {}),
    [thread.messages]
  );

  return (
    <article className="reader-card">
      <header className="reader-header">
        <div className="reader-title">
          <span className="eyebrow">Conversation</span>
          <h2>{thread.subject}</h2>
          <p>{thread.participants.join(", ")}</p>
        </div>

        <div className="reader-actions">
          {readerMessage ? <span className={trustClassMap[readerMessage.trust]}>{readerMessage.trust}</span> : null}
          {readerMessage ? (
            <button
              className={readerMessage.flagged ? "reader-action-button flag-button-active" : "reader-action-button"}
              onClick={() => onToggleFlag(!readerMessage.flagged)}
              type="button"
            >
              {readerMessage.flagged ? "Unstar" : "Star"}
            </button>
          ) : null}
          <div className="more-menu-shell">
            <button
              className="reader-action-button"
              onClick={() => setMoreMenuOpen((current) => !current)}
              type="button"
            >
              More
            </button>
            {moreMenuOpen ? (
              <div className="more-menu">
                <button onClick={onMarkUnread} type="button">
                  Mark as unread
                </button>
                <button onClick={onMarkSpam} type="button">
                  Mark as spam
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="thread-stream">
        {thread.messages.map((message) => (
          <article className="thread-message" key={message.id}>
            <div className="thread-topline">
              <div className="thread-person">
                <span className="message-avatar">{getInitials(message.sender)}</span>
                <div>
                  <strong>{message.sender}</strong>
                  <p>{message.address}</p>
                </div>
              </div>
              <div className="thread-topline-meta">
                <span>{message.sentAt}</span>
                <span className={message.verified ? "mini-pill mini-pill-success" : "mini-pill mini-pill-warning"}>
                  {message.verified ? "verified" : "review"}
                </span>
              </div>
            </div>

            {message.contentMode === "remote-pending" ? (
              loadingMessageBodyId === message.id ? (
                <div className="thread-loading-shell" aria-live="polite">
                  <div className="skeleton-bar" style={{ width: "60%", height: "18px" }} />
                  <div className="skeleton-bar" style={{ width: "100%", height: "14px" }} />
                  <div className="skeleton-bar" style={{ width: "90%", height: "14px" }} />
                  <div className="skeleton-bar" style={{ width: "75%", height: "14px" }} />
                </div>
              ) : (
                <div className="thread-warning">
                  This message was synced as headers only. Open it from the list to fetch the full RFC822 body.
                </div>
              )
            ) : null}

            {message.html && !messageViewMode[message.id] ? (
              <div className="html-choice-banner">
                <span>This message contains HTML content.</span>
                <div className="html-choice-actions">
                  <button
                    className="html-choice-button"
                    onClick={() => handleShowHtml(message.id)}
                    type="button"
                  >
                    Show formatted version
                  </button>
                  <button
                    className="html-choice-button html-choice-button-secondary"
                    onClick={() =>
                      setMessageViewMode((currentMode) => ({
                        ...currentMode,
                        [message.id]: "plain"
                      }))
                    }
                    type="button"
                  >
                    Keep plain text
                  </button>
                </div>
              </div>
            ) : null}

            {message.html && htmlLoadingMessageId === message.id ? (
              <div className="html-loading-shell" aria-live="polite">
                <span className="html-spinner" aria-hidden="true" />
              </div>
            ) : message.html && messageViewMode[message.id] === "html" ? (
              <div
                className="html-email-body body-fade-in"
                dangerouslySetInnerHTML={{ __html: readerHtmlChoices[message.id] ?? "" }}
              />
            ) : (
              <pre className="thread-body body-fade-in">{message.body}</pre>
            )}

            {message.attachments.length > 0 ? (
              <section className="attachment-section">
                <span className="attachment-label">Attachments</span>
                <div className="attachment-list">
                  {message.attachments.map((attachment) => (
                    <div className="attachment-chip" key={`${message.id}-${attachment.filename}-${attachment.size}`}>
                      <span className="attachment-chip-copy">
                        <span className="attachment-icon" aria-hidden="true">
                          📎
                        </span>
                        <span>
                          <strong>{attachment.filename}</strong>
                          <span>{formatAttachmentSize(attachment.size)}</span>
                        </span>
                      </span>
                      <button
                        className="attachment-download"
                        onClick={() => {
                          void handleAttachmentSave(attachment);
                        }}
                        type="button"
                      >
                        Download
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </article>
        ))}
      </div>

      <footer className="compose-actions">
        <select
          className="move-select"
          defaultValue=""
          onChange={(event) => {
            if (event.target.value) {
              onMove(event.target.value);
              event.target.value = "";
            }
          }}
        >
          <option value="">Move to...</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.name}>
              {folder.name}
            </option>
          ))}
        </select>
        <button className="secondary-button" onClick={onArchive} type="button">
          Archive
        </button>
        <button className="secondary-button" onClick={onDelete} type="button">
          Delete
        </button>
        <button className="secondary-button" onClick={onReply} type="button">
          Reply
        </button>
        <button className="primary-button" onClick={onForward} type="button">
          Forward
        </button>
      </footer>
    </article>
  );
}
