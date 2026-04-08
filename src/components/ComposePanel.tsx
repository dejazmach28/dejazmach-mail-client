import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AccountSummary, Attachment, CreateDraftInput } from "../../shared/contracts.js";

const RichTextEditor = lazy(async () => {
  const module = await import("./RichTextEditor.js");
  return { default: module.RichTextEditor };
});

type ComposePanelProps = {
  accounts: AccountSummary[];
  draftForm: CreateDraftInput;
  isSavingDraft: boolean;
  isSendingMessage: boolean;
  onDiscard: () => void;
  onFieldChange: <K extends keyof CreateDraftInput>(field: K, value: CreateDraftInput[K]) => void;
  onSend: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const stripHtmlToPlainText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const looksLikeHtml = (value: string) => /<[^>]+>/.test(value);

const isEffectivelyEmptyHtml = (value?: string) =>
  !value ||
  value
    .replace(/<p><\/p>/gi, "")
    .replace(/<p><br><\/p>/gi, "")
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, "")
    .replace(/\s+/g, "")
    .length === 0;

export function ComposePanel({
  accounts,
  draftForm,
  isSavingDraft,
  isSendingMessage,
  onDiscard,
  onFieldChange,
  onSend,
  onSubmit
}: ComposePanelProps) {
  const [showCc, setShowCc] = useState(Boolean(draftForm.cc));
  const [showBcc, setShowBcc] = useState(Boolean(draftForm.bcc));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const signatureInjectedForAccountRef = useRef<string | null>(null);

  useEffect(() => {
    const hasPlainContent = draftForm.body.trim().length > 0;
    const hasHtmlContent = !isEffectivelyEmptyHtml(draftForm.htmlBody);

    if (
      !window.desktopApi ||
      !draftForm.accountId ||
      hasPlainContent ||
      hasHtmlContent ||
      signatureInjectedForAccountRef.current === draftForm.accountId
    ) {
      return;
    }

    void window.desktopApi.getSignature(draftForm.accountId).then((result) => {
      if (!result.ok || !result.data.body.trim()) {
        return;
      }

      const signature = result.data.body.trim();
      signatureInjectedForAccountRef.current = draftForm.accountId;
      if (looksLikeHtml(signature)) {
        const htmlSignature = `<p><br /></p><p><br /></p><div class="signature-divider">-- </div>${signature}`;
        onFieldChange("htmlBody", htmlSignature);
        onFieldChange("body", `\n\n-- \n${stripHtmlToPlainText(signature)}`);
        return;
      }

      onFieldChange("body", `\n\n-- \n${signature}`);
    });
  }, [draftForm.accountId, draftForm.body, draftForm.htmlBody, onFieldChange]);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const current: Attachment[] = draftForm.attachments ?? [];
    const readers: Promise<Attachment>[] = Array.from(files).map(
      (file) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            // dataUrl = "data:mime/type;base64,XXXXX"
            const base64 = dataUrl.split(",")[1] ?? "";
            resolve({ filename: file.name, mimeType: file.type || "application/octet-stream", size: file.size, data: base64 });
          };
          reader.readAsDataURL(file);
        })
    );
    void Promise.all(readers).then((newAttachments) => {
      onFieldChange("attachments", [...current, ...newAttachments]);
    });
    // Reset input so same file can be re-added
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    const next = (draftForm.attachments ?? []).filter((_, i) => i !== index);
    onFieldChange("attachments", next);
  };

  return (
    <article className="reader-card">
      <header className="pane-header">
        <div>
          <span className="eyebrow">Compose</span>
          <h2>New message</h2>
        </div>
        <button className="secondary-button" onClick={onDiscard} type="button">
          Discard
        </button>
      </header>

      <form className="compose-form" onSubmit={onSubmit}>
        <div className="compose-grid">
          <label className="field field-full">
            <span>Account</span>
            <select
              onChange={(event) => onFieldChange("accountId", event.target.value)}
              required
              value={draftForm.accountId}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.address}
                </option>
              ))}
            </select>
          </label>

          <label className="field field-full">
            <span>To</span>
            <input
              onChange={(event) => onFieldChange("to", event.target.value)}
              placeholder="recipient@example.com"
              value={draftForm.to}
            />
          </label>

          <div className="field field-full">
            {!showCc && !showBcc ? (
              <div className="compose-optional-links">
                <button className="inline-link" onClick={() => setShowCc(true)} type="button">+ CC</button>
                <button className="inline-link" onClick={() => setShowBcc(true)} type="button">+ BCC</button>
              </div>
            ) : null}
            {showCc ? (
              <label className="field field-full">
                <span>CC</span>
                <input
                  onChange={(event) => onFieldChange("cc", event.target.value)}
                  placeholder="copy@example.com"
                  value={draftForm.cc ?? ""}
                />
              </label>
            ) : null}
            {!showCc && showBcc ? (
              <button className="inline-link" onClick={() => setShowCc(true)} type="button">+ CC</button>
            ) : null}
            {showBcc ? (
              <label className="field field-full">
                <span>BCC</span>
                <input
                  onChange={(event) => onFieldChange("bcc", event.target.value)}
                  placeholder="hidden@example.com"
                  value={draftForm.bcc ?? ""}
                />
              </label>
            ) : null}
            {showCc && !showBcc ? (
              <button className="inline-link" onClick={() => setShowBcc(true)} type="button">+ BCC</button>
            ) : null}
          </div>

          <label className="field field-full">
            <span>Subject</span>
            <input onChange={(event) => onFieldChange("subject", event.target.value)} value={draftForm.subject} />
          </label>

          <div className="field field-full compose-body-field">
            <span>Body</span>
            <Suspense fallback={<textarea placeholder="Loading editor..." rows={12} value={draftForm.body} readOnly />}>
              <RichTextEditor
                value={draftForm.htmlBody ?? draftForm.body}
                onChange={(html, plain) => {
                  onFieldChange("htmlBody", html);
                  onFieldChange("body", plain);
                }}
              />
            </Suspense>
          </div>

          {/* Attachments */}
          <div className="field field-full">
            <div className="compose-attach-row">
              <button
                className="inline-link"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                + Attach files
              </button>
              <input
                accept="*/*"
                className="compose-file-input"
                multiple
                onChange={(e) => handleFiles(e.target.files)}
                ref={fileInputRef}
                type="file"
              />
            </div>
            {(draftForm.attachments ?? []).length > 0 ? (
              <div className="compose-attachment-list">
                {(draftForm.attachments ?? []).map((att, index) => (
                  <div className="compose-attachment-chip" key={`${att.filename}-${index}`}>
                    <span className="compose-attachment-name">📎 {att.filename}</span>
                    <span className="compose-attachment-size">{formatSize(att.size)}</span>
                    <button
                      aria-label={`Remove ${att.filename}`}
                      className="compose-attachment-remove"
                      onClick={() => removeAttachment(index)}
                      type="button"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="compose-actions">
          <button className="secondary-button" disabled={isSavingDraft} type="submit">
            {isSavingDraft ? "Saving..." : "Save draft"}
          </button>
          <button
            className="primary-button"
            disabled={isSendingMessage || !draftForm.accountId}
            onClick={onSend}
            type="button"
          >
            {isSendingMessage ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </article>
  );
}
