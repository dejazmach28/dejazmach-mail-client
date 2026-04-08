import type { FormEvent } from "react";
import type { CreateAccountInput } from "../../shared/contracts.js";

type OnboardingFormProps = {
  compact?: boolean;
  form: CreateAccountInput;
  isSavingAccount: boolean;
  subtitle: string;
  title: string;
  onCancel?: () => void;
  onFieldChange: <K extends keyof CreateAccountInput>(field: K, value: CreateAccountInput[K]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function OnboardingForm({
  compact = false,
  form,
  isSavingAccount,
  subtitle,
  title,
  onCancel,
  onFieldChange,
  onSubmit
}: OnboardingFormProps) {
  return (
    <article className={compact ? "modal-card onboarding-card" : "onboarding-card"}>
      <header className="onboarding-header">
        <div className="onboarding-header-text">
          <span className="eyebrow">{subtitle}</span>
          <h2>{title}</h2>
          <p>Enter the mailbox details exactly as provided by your mail host. Folders are discovered from IMAP after verification.</p>
        </div>
        {compact && onCancel ? (
          <button aria-label="Close" className="modal-close-button" onClick={onCancel} type="button">✕</button>
        ) : null}
      </header>

      <form className="account-form" onSubmit={onSubmit} aria-busy={isSavingAccount}>
        <section className="form-section">
          <div className="section-heading-row">
            <strong>Identity</strong>
            <span>How this account appears in DejAzmach.</span>
          </div>

          <div className="form-grid form-grid-two">
            <label className="field">
              <span>Display name</span>
              <input onChange={(event) => onFieldChange("name", event.target.value)} required value={form.name} />
            </label>

            <label className="field">
              <span>Email address</span>
              <input onChange={(event) => onFieldChange("address", event.target.value)} required type="email" value={form.address} />
            </label>

            <label className="field">
              <span>Provider label</span>
              <input onChange={(event) => onFieldChange("provider", event.target.value)} required value={form.provider} />
            </label>

            <label className="field">
              <span>Username</span>
              <input onChange={(event) => onFieldChange("username", event.target.value)} required value={form.username} />
            </label>

            <label className="field field-full">
              <span>Password or app password</span>
              <input
                onChange={(event) => onFieldChange("password", event.target.value)}
                required
                type="password"
                value={form.password}
              />
            </label>
          </div>
        </section>

        <section className="form-section">
          <div className="section-heading-row">
            <strong>Incoming IMAP</strong>
            <span>Used for folder discovery and mailbox synchronization.</span>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Server</span>
              <input onChange={(event) => onFieldChange("incomingServer", event.target.value)} required value={form.incomingServer} />
            </label>

            <label className="field">
              <span>Port</span>
              <input
                max={65535}
                min={1}
                onChange={(event) => onFieldChange("incomingPort", Number(event.target.value) || 0)}
                required
                type="number"
                value={form.incomingPort}
              />
            </label>

            <label className="field">
              <span>Security</span>
              <select
                onChange={(event) => onFieldChange("incomingSecurity", event.target.value as CreateAccountInput["incomingSecurity"])}
                value={form.incomingSecurity}
              >
                <option value="ssl_tls">SSL/TLS</option>
                <option value="starttls">STARTTLS</option>
                <option value="plain">Plain</option>
              </select>
            </label>
          </div>
        </section>

        <section className="form-section">
          <div className="section-heading-row">
            <strong>Outgoing SMTP</strong>
            <span>Used for authenticated sending and delivery tests.</span>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Server</span>
              <input onChange={(event) => onFieldChange("outgoingServer", event.target.value)} required value={form.outgoingServer} />
            </label>

            <label className="field">
              <span>Port</span>
              <input
                max={65535}
                min={1}
                onChange={(event) => onFieldChange("outgoingPort", Number(event.target.value) || 0)}
                required
                type="number"
                value={form.outgoingPort}
              />
            </label>

            <label className="field">
              <span>Security</span>
              <select
                onChange={(event) => onFieldChange("outgoingSecurity", event.target.value as CreateAccountInput["outgoingSecurity"])}
                value={form.outgoingSecurity}
              >
                <option value="ssl_tls">SSL/TLS</option>
                <option value="starttls">STARTTLS</option>
                <option value="plain">Plain</option>
              </select>
            </label>

            <label className="field">
              <span>SMTP auth</span>
              <select
                onChange={(event) => onFieldChange("outgoingAuthMethod", event.target.value as CreateAccountInput["outgoingAuthMethod"])}
                value={form.outgoingAuthMethod}
              >
                <option value="auto">Automatic</option>
                <option value="plain">AUTH PLAIN</option>
                <option value="login">AUTH LOGIN</option>
                <option value="none">No SMTP auth</option>
              </select>
            </label>
          </div>
        </section>

        <div className="button-row">
          <button className="primary-button" disabled={isSavingAccount} type="submit">
            {isSavingAccount ? "Connecting to server…" : "Add account"}
          </button>
          {compact && onCancel ? (
            <button className="secondary-button" onClick={onCancel} type="button">
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </article>
  );
}
