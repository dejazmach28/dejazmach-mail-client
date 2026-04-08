import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";
import { RichTextEditor } from "./RichTextEditor.js";

type SignatureEditorProps = {
  accountId: string;
  onSaved: () => void;
};

type SignatureMode = "design" | "html" | "plain";

const looksLikeHtml = (value: string) => /<[^>]+>/.test(value);

const plainTextToHtml = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;"))
    .join("<br />");

const htmlToPlain = (html: string) =>
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
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function SignatureEditor({ accountId, onSaved }: SignatureEditorProps) {
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<SignatureMode>("design");
  const [isSaving, setIsSaving] = useState(false);
  const htmlFileInputRef = useRef<HTMLInputElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!window.desktopApi || !accountId) {
      return;
    }

    void window.desktopApi.getSignature(accountId).then((result) => {
      if (!result.ok) {
        return;
      }

      const nextBody = result.data.body;
      setBody(nextBody);
      setMode(looksLikeHtml(nextBody) ? "design" : "plain");
    });
  }, [accountId]);

  const renderedPreview = useMemo(() => {
    if (!body.trim()) {
      return "";
    }

    if (mode === "plain") {
      return plainTextToHtml(body);
    }

    return DOMPurify.sanitize(body);
  }, [body, mode]);

  const handleFileImport = async (file: File | null) => {
    if (!file) {
      return;
    }

    const readAsText = () =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.readAsText(file);
      });

    const readAsDataUrl = () =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.readAsDataURL(file);
      });

    if (file.type.startsWith("image/")) {
      const dataUrl = await readAsDataUrl();
      setMode("design");
      setBody((current) => `${current}${current ? "<p><br /></p>" : ""}<img src="${dataUrl}" alt="${file.name}" />`);
      return;
    }

    const content = await readAsText();
    setMode(looksLikeHtml(content) ? "html" : "plain");
    setBody(content);
  };

  const handlePasteHtml = async () => {
    if (!navigator.clipboard?.readText) {
      return;
    }

    const clipboardText = await navigator.clipboard.readText();
    if (!clipboardText.trim()) {
      return;
    }

    setMode(looksLikeHtml(clipboardText) ? "html" : "plain");
    setBody(clipboardText);
  };

  const handleSave = async () => {
    if (!window.desktopApi) {
      return;
    }

    setIsSaving(true);

    try {
      const valueToSave = mode === "plain" ? body : body.trim();
      const result = await window.desktopApi.setSignature({ accountId, body: valueToSave });
      if (!result.ok) {
        throw new Error(result.error);
      }
      onSaved();
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setBody("");

    if (!window.desktopApi) {
      return;
    }

    setIsSaving(true);

    try {
      const result = await window.desktopApi.setSignature({ accountId, body: "" });
      if (!result.ok) {
        throw new Error(result.error);
      }
      onSaved();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="settings-card">
      <span className="eyebrow">Signature</span>
      <h3>Outgoing signature</h3>
      <p className="settings-meta-copy">
        Use the visual designer, paste raw HTML, or import an HTML file or image. DejAzmach saves exactly what you enter.
      </p>

      <div className="signature-toolbar">
        <button
          className={mode === "design" ? "settings-tab settings-tab-active" : "settings-tab"}
          onClick={() => setMode("design")}
          type="button"
        >
          Design
        </button>
        <button
          className={mode === "html" ? "settings-tab settings-tab-active" : "settings-tab"}
          onClick={() => setMode("html")}
          type="button"
        >
          HTML source
        </button>
        <button
          className={mode === "plain" ? "settings-tab settings-tab-active" : "settings-tab"}
          onClick={() => setMode("plain")}
          type="button"
        >
          Plain text
        </button>

        <button className="secondary-button" onClick={() => htmlFileInputRef.current?.click()} type="button">
          Upload HTML
        </button>
        <button className="secondary-button" onClick={() => imageFileInputRef.current?.click()} type="button">
          Upload Image
        </button>
        <button className="secondary-button" onClick={() => void handlePasteHtml()} type="button">
          Paste HTML
        </button>

        <input
          accept=".html,.htm,text/html,text/plain"
          className="compose-file-input"
          onChange={(event) => void handleFileImport(event.target.files?.[0] ?? null)}
          ref={htmlFileInputRef}
          type="file"
        />
        <input
          accept="image/*"
          className="compose-file-input"
          onChange={(event) => void handleFileImport(event.target.files?.[0] ?? null)}
          ref={imageFileInputRef}
          type="file"
        />
      </div>

      {mode === "design" ? (
        <div className="field field-full signature-editor-field">
          <span>Visual signature</span>
          <RichTextEditor
            onChange={(html) => {
              setBody(html);
            }}
            value={looksLikeHtml(body) ? body : plainTextToHtml(body)}
          />
        </div>
      ) : mode === "html" ? (
        <label className="field field-full">
          <span>HTML source</span>
          <textarea
            className="signature-textarea signature-source-textarea"
            onChange={(event) => setBody(event.target.value)}
            rows={14}
            spellCheck={false}
            value={body}
          />
        </label>
      ) : (
        <label className="field field-full">
          <span>Plain text signature</span>
          <textarea
            className="signature-textarea"
            onChange={(event) => setBody(event.target.value)}
            rows={10}
            value={body}
          />
        </label>
      )}

      {renderedPreview ? (
        <div className="signature-preview-shell">
          <span>Preview</span>
          <div
            className="signature-preview"
            dangerouslySetInnerHTML={{ __html: renderedPreview }}
          />
        </div>
      ) : null}

      <span className="signature-count">
        {mode === "plain" ? body.length : htmlToPlain(body).length} characters
      </span>

      <div className="compose-actions compose-actions-inline">
        <button className="secondary-button" disabled={isSaving} onClick={() => void handleClear()} type="button">
          Clear
        </button>
        <button className="primary-button" disabled={isSaving} onClick={() => void handleSave()} type="button">
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
