import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";
import { RichTextEditor } from "./RichTextEditor.js";

type SignatureEditorProps = {
  accountId: string;
  onSaved: () => void;
};

type SignatureMode = "design" | "html" | "plain";

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
  const [htmlBody, setHtmlBody] = useState("");
  const [plainText, setPlainText] = useState("");
  const [format, setFormat] = useState<"html" | "plain">("plain");
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

      setHtmlBody(result.data.html);
      setPlainText(result.data.plainText);
      setFormat(result.data.format);
      setMode(result.data.format === "html" ? "design" : "plain");
    });
  }, [accountId]);

  const renderedPreview = useMemo(() => {
    if (format === "plain" && !plainText.trim()) {
      return "";
    }

    if (format === "html" && !htmlBody.trim()) {
      return "";
    }

    if (format === "plain") {
      return plainTextToHtml(plainText);
    }

    return DOMPurify.sanitize(htmlBody);
  }, [format, htmlBody, plainText]);

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
      setFormat("html");
      setHtmlBody((current) => `${current}${current ? "<p><br /></p>" : ""}<img src="${dataUrl}" alt="${file.name}" />`);
      setPlainText((current) => current);
      return;
    }

    const content = await readAsText();
    if (/<[^>]+>/.test(content)) {
      setFormat("html");
      setMode("html");
      setHtmlBody(content);
      setPlainText(htmlToPlain(content));
    } else {
      setFormat("plain");
      setMode("plain");
      setPlainText(content);
      setHtmlBody("");
    }
  };

  const handlePasteHtml = async () => {
    if (!navigator.clipboard?.readText) {
      return;
    }

    const clipboardText = await navigator.clipboard.readText();
    if (!clipboardText.trim()) {
      return;
    }

    if (/<[^>]+>/.test(clipboardText)) {
      setFormat("html");
      setMode("html");
      setHtmlBody(clipboardText);
      setPlainText(htmlToPlain(clipboardText));
    } else {
      setFormat("plain");
      setMode("plain");
      setPlainText(clipboardText);
      setHtmlBody("");
    }
  };

  const handleSave = async () => {
    if (!window.desktopApi) {
      return;
    }

    setIsSaving(true);

    try {
      const nextFormat = mode === "plain" ? "plain" : "html";
      const nextHtml = nextFormat === "html" ? htmlBody.trim() : "";
      const nextPlainText = nextFormat === "html" ? htmlToPlain(htmlBody) : plainText;
      const result = await window.desktopApi.setSignature({
        accountId,
        html: nextHtml,
        plainText: nextPlainText,
        format: nextFormat
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
      setFormat(nextFormat);
      setPlainText(nextPlainText);
      onSaved();
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setHtmlBody("");
    setPlainText("");
    setFormat("plain");

    if (!window.desktopApi) {
      return;
    }

    setIsSaving(true);

    try {
      const result = await window.desktopApi.setSignature({
        accountId,
        html: "",
        plainText: "",
        format: "plain"
      });
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
          onClick={() => {
            setMode("design");
            setFormat("html");
          }}
          type="button"
        >
          Design
        </button>
        <button
          className={mode === "html" ? "settings-tab settings-tab-active" : "settings-tab"}
          onClick={() => {
            setMode("html");
            setFormat("html");
          }}
          type="button"
        >
          HTML source
        </button>
        <button
          className={mode === "plain" ? "settings-tab settings-tab-active" : "settings-tab"}
          onClick={() => {
            setMode("plain");
            setFormat("plain");
          }}
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
            onChange={(html, plain) => {
              setFormat("html");
              setHtmlBody(html);
              setPlainText(plain);
            }}
            value={htmlBody || plainTextToHtml(plainText)}
          />
        </div>
      ) : mode === "html" ? (
        <label className="field field-full">
          <span>HTML source</span>
          <textarea
            className="signature-textarea signature-source-textarea"
            onChange={(event) => {
              setFormat("html");
              setHtmlBody(event.target.value);
              setPlainText(htmlToPlain(event.target.value));
            }}
            rows={14}
            spellCheck={false}
            value={htmlBody}
          />
        </label>
      ) : (
        <label className="field field-full">
          <span>Plain text signature</span>
          <textarea
            className="signature-textarea"
            onChange={(event) => {
              setFormat("plain");
              setPlainText(event.target.value);
            }}
            rows={10}
            value={plainText}
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
        {(format === "plain" ? plainText : htmlToPlain(htmlBody)).length} characters
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
