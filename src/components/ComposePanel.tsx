import type { FormEvent } from "react";
import type { AccountSummary, CreateDraftInput } from "../../shared/contracts.js";

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

          <label className="field field-full">
            <span>Subject</span>
            <input onChange={(event) => onFieldChange("subject", event.target.value)} value={draftForm.subject} />
          </label>

          <label className="field field-full">
            <span>Body</span>
            <textarea onChange={(event) => onFieldChange("body", event.target.value)} rows={16} value={draftForm.body} />
          </label>
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
