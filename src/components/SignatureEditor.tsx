import DOMPurify from "dompurify";
import { useEffect, useRef, useState } from "react";

type SignatureEditorProps = {
  accountId: string;
  onSaved: () => void;
};

export function SignatureEditor({ accountId, onSaved }: SignatureEditorProps) {
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [mode, setMode] = useState<"html" | "plain">("html");
  const htmlFileInputRef = useRef<HTMLInputElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!window.desktopApi || !accountId) {
      return;
    }

    void window.desktopApi.getSignature(accountId).then((result) => {
      if (result.ok) {
        setBody(result.data.body);
        setMode(/<[^>]+>/.test(result.data.body) ? "html" : "plain");
      }
    });
  }, [accountId]);

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
      setMode("html");
      setBody((current) => `${current}${current ? "\n" : ""}<img src="${dataUrl}" alt="${file.name}" />`);
      return;
    }

    const content = await readAsText();
    setMode(/<[^>]+>/.test(content) ? "html" : "plain");
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

    setMode(/<[^>]+>/.test(clipboardText) ? "html" : "plain");
    setBody(clipboardText);
  };

  const handleSave = async () => {
    if (!window.desktopApi) {
      return;
    }

    setIsSaving(true);

    try {
      const result = await window.desktopApi.setSignature({ accountId, body });
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
      <div className="signature-toolbar">
        <button
          className={mode === "html" ? "settings-tab settings-tab-active" : "settings-tab"}
          onClick={() => setMode("html")}
          type="button"
        >
          HTML
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
      <div className="field">
        <span>{mode === "html" ? "HTML / markup" : "Plain text"}</span>
        <textarea
          className="signature-textarea"
          onChange={(event) => setBody(event.target.value)}
          rows={10}
          value={body}
        />
      </div>
      {mode === "html" && body.trim() ? (
        <div className="signature-preview-shell">
          <span>Preview</span>
          <div
            className="signature-preview"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(body) }}
          />
        </div>
      ) : null}
      <span className="signature-count">{body.length} characters</span>
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
