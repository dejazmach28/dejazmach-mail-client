import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";
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
  onReplyAll: () => void;
  onForward: () => void;
  onBack?: () => void;
};

const getInitials = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "M";

const removeExternalCssUrls = (value: string) =>
  value
    .replace(/@import\s+url\((?!['"]?(?:data:|cid:))[^)]*\)\s*;?/gi, "")
    .replace(/url\((?!['"]?(?:data:|cid:))[^)]*\)/gi, "none");

const isSafeEmbeddedResource = (value: string) => /^(data:|cid:|blob:)/i.test(value.trim());

const isSafeNavigationTarget = (value: string) =>
  /^(https?:|mailto:|#)/i.test(value.trim());

const sanitizeHtmlForFrame = (html: string): string => {
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "link"],
    FORBID_ATTR: ["srcset"]
  });
  const document = new DOMParser().parseFromString(sanitized, "text/html");

  for (const styleElement of Array.from(document.querySelectorAll("style"))) {
    styleElement.textContent = removeExternalCssUrls(styleElement.textContent ?? "");
  }

  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) {
        element.removeAttribute(attribute.name);
      }
    }

    const inlineStyle = element.getAttribute("style");
    if (inlineStyle) {
      element.setAttribute("style", removeExternalCssUrls(inlineStyle));
    }

    for (const attributeName of ["src", "poster", "background", "action", "formaction"]) {
      const value = element.getAttribute(attributeName);
      if (value && !isSafeEmbeddedResource(value)) {
        element.removeAttribute(attributeName);
      }
    }

    const href = element.getAttribute("href");
    if (href) {
      if (!isSafeNavigationTarget(href)) {
        element.setAttribute("href", "#");
      } else if (/^https?:/i.test(href.trim())) {
        element.setAttribute("rel", "noreferrer noopener");
        element.setAttribute("target", "_blank");
      }
    }
  }

  return document.body.innerHTML;
};

const buildHtmlDocument = (html: string) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data: cid:; media-src data:; font-src data:; style-src 'unsafe-inline';"
    />
    <base target="_blank" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #111827;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.6;
      }
      body {
        padding: 0;
        overflow-wrap: anywhere;
      }
      img, table {
        max-width: 100%;
      }
      pre {
        white-space: pre-wrap;
      }
      a {
        color: #2563eb;
      }
    </style>
  </head>
  <body>${sanitizeHtmlForFrame(html)}</body>
</html>`;

function HtmlMessageFrame({ documentMarkup }: { documentMarkup: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameHeight, setFrameHeight] = useState(360);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const syncHeight = () => {
      try {
        const doc = frame.contentDocument;
        if (!doc) {
          return;
        }

        const nextHeight = Math.max(
          doc.documentElement?.scrollHeight ?? 0,
          doc.body?.scrollHeight ?? 0,
          360
        );

        setFrameHeight(Math.min(nextHeight + 8, 2200));
      } catch {
        setFrameHeight(640);
      }
    };

    const handleLoad = () => {
      window.setTimeout(syncHeight, 20);
    };

    frame.addEventListener("load", handleLoad);
    handleLoad();

    return () => {
      frame.removeEventListener("load", handleLoad);
    };
  }, [documentMarkup]);

  return (
    <iframe
      className="html-email-frame body-fade-in"
      ref={frameRef}
      sandbox="allow-popups"
      srcDoc={documentMarkup}
      style={{ height: `${frameHeight}px` }}
      title="Formatted email body"
    />
  );
}

const formatAttachmentSize = (size: number) => {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`;
};

const handleAttachmentSave = async (attachment: Attachment) => {
  if (!window.desktopApi) return;
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
  onReplyAll,
  onForward,
  onBack
}: MessageReaderProps) {
  const [messageViewMode, setMessageViewMode] = useState<Record<string, "html" | "plain">>({});
  const [htmlLoadingMessageId, setHtmlLoadingMessageId] = useState<string | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moveMenuRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  // Close menus when clicking outside
  useEffect(() => {
    if (!moreMenuOpen && !moveMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) {
        setMoveMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreMenuOpen, moveMenuOpen]);

  // Scroll to top when thread changes
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = 0;
    }
  }, [thread?.id]);

  const handleShowHtml = (messageId: string) => {
    setHtmlLoadingMessageId(messageId);
    window.setTimeout(() => {
      setMessageViewMode((currentMode) => ({ ...currentMode, [messageId]: "html" }));
      setHtmlLoadingMessageId((currentId) => (currentId === messageId ? null : currentId));
    }, 120);
  };

  // Must be before any early return to satisfy the rules of hooks.
  const readerHtmlChoices = useMemo(
    () =>
      (thread?.messages ?? []).reduce<Record<string, string>>((accumulator, message) => {
        if (message.html) {
          accumulator[message.id] = buildHtmlDocument(message.html);
        }
        return accumulator;
      }, {}),
    [thread?.messages]
  );

  if (!thread) {
    return (
      <article className="reader-card">
        {onBack ? (
          <button
            aria-label="Back to message list"
            className="reader-back-button reader-back-button-empty"
            onClick={onBack}
            type="button"
          >
            ← Back
          </button>
        ) : null}
        <div className="empty-panel empty-panel-reader">
          <div className="empty-panel-icon" aria-hidden="true">✉</div>
          <h3>No conversation selected</h3>
          <p>Select a message from the list or compose a new one.</p>
        </div>
      </article>
    );
  }

  return (
    <article className="reader-card">
      <header className="reader-header">
        {onBack ? (
          <button
            aria-label="Back to message list"
            className="reader-back-button"
            onClick={onBack}
            type="button"
          >
            ← Back
          </button>
        ) : null}
        <div className="reader-title">
          <span className="eyebrow">Conversation · {thread.messages.length} {thread.messages.length === 1 ? "message" : "messages"}</span>
          <h2>{thread.subject}</h2>
          <p className="reader-participants">{thread.participants.join(", ")}</p>
        </div>

        <div className="reader-actions">
          {readerMessage ? (
            <button
              aria-label={readerMessage.flagged ? "Unstar message" : "Star message"}
              className="btn-icon"
              onClick={() => onToggleFlag(!readerMessage.flagged)}
              title={readerMessage.flagged ? "Remove star" : "Star this message"}
              type="button"
            >
              <span className={readerMessage.flagged ? "flag-button flag-button-active" : "flag-button"}>
                {readerMessage.flagged ? "★" : "☆"}
              </span>
            </button>
          ) : null}
          <div className="more-menu-shell" ref={moreMenuRef}>
            <button
              aria-label="More actions"
              className="btn-icon"
              onClick={() => setMoreMenuOpen((current) => !current)}
              type="button"
            >
              ⋯
            </button>
            {moreMenuOpen ? (
              <div className="more-menu" role="menu">
                <button onClick={() => { setMoreMenuOpen(false); onMarkUnread(); }} role="menuitem" type="button">
                  Mark as unread
                </button>
                <button onClick={() => { setMoreMenuOpen(false); onMarkSpam(); }} role="menuitem" type="button">
                  Mark as spam
                </button>
                <div className="more-menu-divider" />
                <button onClick={() => { setMoreMenuOpen(false); window.print(); }} role="menuitem" type="button">
                  Print
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="thread-stream" ref={streamRef}>
        {thread.messages.map((message, index) => (
          <article className="thread-message" key={message.id}>
            <div className="thread-topline">
              <div className="thread-person">
                <span className="message-avatar thread-avatar">{getInitials(message.sender)}</span>
                <div className="thread-sender-info">
                  <strong className="thread-sender-name">{message.sender}</strong>
                  <span className="thread-sender-addr">{message.address}</span>
                  {message.to ? (
                    <span className="thread-meta-row"><span className="thread-meta-label">To:</span> {message.to}</span>
                  ) : null}
                  {message.cc ? (
                    <span className="thread-meta-row"><span className="thread-meta-label">CC:</span> {message.cc}</span>
                  ) : null}
                </div>
              </div>
              <div className="thread-topline-meta">
                <span className="thread-timestamp">{message.sentAt}</span>
                <span className={message.verified ? "mini-pill mini-pill-success" : "mini-pill mini-pill-warning"}>
                  {message.verified ? "✓ verified" : "⚠ review"}
                </span>
              </div>
            </div>

            {message.contentMode === "remote-pending" ? (
              loadingMessageBodyId === message.id ? (
                <div className="thread-loading-shell" aria-live="polite">
                  <div className="skeleton-bar" style={{ width: "55%", height: "16px" }} />
                  <div className="skeleton-bar" style={{ width: "100%", height: "13px" }} />
                  <div className="skeleton-bar" style={{ width: "88%", height: "13px" }} />
                  <div className="skeleton-bar" style={{ width: "72%", height: "13px" }} />
                  <div className="skeleton-bar" style={{ width: "80%", height: "13px" }} />
                </div>
              ) : (
                <div className="thread-warning">
                  Headers only — select this message in the list to fetch the full body.
                </div>
              )
            ) : null}

            {message.html && !messageViewMode[message.id] ? (
              <div className="html-choice-banner">
                <span className="html-choice-label">HTML version available</span>
                <div className="html-choice-actions">
                  <button
                    className="html-choice-button"
                    onClick={() => handleShowHtml(message.id)}
                    type="button"
                  >
                    Show formatted
                  </button>
                  <button
                    className="html-choice-button html-choice-button-secondary"
                    onClick={() => setMessageViewMode((currentMode) => ({ ...currentMode, [message.id]: "plain" }))}
                    type="button"
                  >
                    Keep plain
                  </button>
                </div>
              </div>
            ) : null}

            {message.html && htmlLoadingMessageId === message.id ? (
              <div className="html-loading-shell" aria-live="polite">
                <span className="html-spinner" aria-hidden="true" />
              </div>
            ) : message.html && messageViewMode[message.id] === "html" ? (
              <HtmlMessageFrame documentMarkup={readerHtmlChoices[message.id] ?? ""} />
            ) : (
              <pre className="thread-body body-fade-in">{message.body}</pre>
            )}

            {message.attachments.length > 0 ? (
              <section className="attachment-section">
                <span className="attachment-label">
                  {message.attachments.length} {message.attachments.length === 1 ? "Attachment" : "Attachments"}
                </span>
                <div className="attachment-list">
                  {message.attachments.map((attachment) => (
                    <div className="attachment-chip" key={`${message.id}-${attachment.filename}-${attachment.size}`}>
                      <span className="attachment-chip-copy">
                        <span className="attachment-icon" aria-hidden="true">📎</span>
                        <span>
                          <strong>{attachment.filename}</strong>
                          <span>{formatAttachmentSize(attachment.size)}</span>
                        </span>
                      </span>
                      <button
                        className="attachment-download"
                        onClick={() => { void handleAttachmentSave(attachment); }}
                        type="button"
                      >
                        ↓ Save
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {/* Show Reply/Forward inline after last message */}
            {index === thread.messages.length - 1 ? (
              <div className="thread-inline-reply">
                <button className="btn-action btn-action-reply" onClick={onReply} type="button">
                  ↩ Reply
                </button>
                <button className="btn-action" onClick={onReplyAll} type="button">
                  ↺ Reply all
                </button>
                <button className="btn-action" onClick={onForward} type="button">
                  ↪ Forward
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <footer className="reader-footer">
        <div className="reader-footer-left">
          <button className="btn-action btn-action-archive" onClick={onArchive} title="Archive" type="button">
            Archive
          </button>
          <div className="more-menu-shell" ref={moveMenuRef}>
            <button className="btn-action" onClick={() => setMoveMenuOpen((current) => !current)} type="button">
              Move ▾
            </button>
            {moveMenuOpen ? (
              <div className="more-menu more-menu-up" role="menu">
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => { setMoveMenuOpen(false); onMove(folder.name); }}
                    role="menuitem"
                    type="button"
                  >
                    {folder.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <button className="btn-action btn-action-danger" onClick={onDelete} title="Delete message" type="button">
          Delete
        </button>
      </footer>
    </article>
  );
}
