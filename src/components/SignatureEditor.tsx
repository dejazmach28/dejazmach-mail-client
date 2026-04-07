import { useEffect, useState } from "react";

type SignatureEditorProps = {
  accountId: string;
  onSaved: () => void;
};

export function SignatureEditor({ accountId, onSaved }: SignatureEditorProps) {
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!window.desktopApi || !accountId) {
      return;
    }

    void window.desktopApi.getSignature(accountId).then((result) => {
      if (result.ok) {
        setBody(result.data.body);
      }
    });
  }, [accountId]);

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
      <div className="field">
        <span>Body</span>
        <textarea
          className="signature-textarea"
          onChange={(event) => setBody(event.target.value)}
          rows={10}
          value={body}
        />
      </div>
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
