import type { MailSummary, ThreadDetail } from "../../shared/contracts.js";

type MessageReaderProps = {
  thread?: ThreadDetail;
  readerMessage?: MailSummary;
  loadingMessageBodyId: string | null;
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

export function MessageReader({
  thread,
  readerMessage,
  loadingMessageBodyId,
  onReply,
  onForward
}: MessageReaderProps) {
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

            {message.contentMode === "html-blocked" ? (
              <div className="thread-warning">
                HTML content was blocked. Only a safe plain-text extraction is shown.
              </div>
            ) : null}

            {message.contentMode === "remote-pending" ? (
              <div className="thread-warning">
                {loadingMessageBodyId === message.id
                  ? "Fetching the full RFC822 body from IMAP..."
                  : "This message was synced as headers only. Open it from the list to fetch the full RFC822 body."}
              </div>
            ) : null}

            <pre className="thread-body">{message.body}</pre>
          </article>
        ))}
      </div>

      <footer className="compose-actions">
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
