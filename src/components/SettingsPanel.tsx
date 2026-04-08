import { useEffect, useState } from "react";
import type {
  AccountSummary,
  NotificationPreferences,
  RuntimeEnvironment,
  WorkspaceSnapshot
} from "../../shared/contracts.js";
import { SignatureEditor } from "./SignatureEditor.js";

type SettingsPanelProps = {
  environment: RuntimeEnvironment;
  platform: string;
  version: string;
  selectedAccount?: AccountSummary;
  verifyingAccountId: string | null;
  onSignatureSaved: () => void;
  onVerifyAccount: (accountId: string) => void;
  onWorkspaceChange: (snapshot: WorkspaceSnapshot) => void;
  onError: (message: string) => void;
  onNotice: (message: string, duration?: number) => void;
};

const accountClassMap = {
  online: "status-pill status-pill-active",
  syncing: "status-pill status-pill-monitoring",
  attention: "status-pill status-pill-critical"
} as const;

const environmentClassMap: Record<RuntimeEnvironment, string> = {
  development: "mini-pill mini-pill-warning",
  production: "mini-pill mini-pill-success"
};

const formatPlatform = (platform: string) => {
  if (!platform) return "Unknown";
  return `${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
};

const defaultPreferences: NotificationPreferences = {
  desktopNotifications: true,
  soundAlert: false,
  badgeCount: true,
  syncIntervalMinutes: 1
};

export function SettingsPanel({
  environment,
  platform,
  version,
  selectedAccount,
  verifyingAccountId,
  onSignatureSaved,
  onVerifyAccount,
  onWorkspaceChange,
  onError,
  onNotice
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<"account" | "signature" | "notifications" | "about">("account");
  const [displayName, setDisplayName] = useState(selectedAccount?.name ?? "");
  const [imapForm, setImapForm] = useState({
    incomingServer: selectedAccount?.incomingServer ?? "",
    incomingPort: selectedAccount?.incomingPort ?? 993,
    incomingSecurity: selectedAccount?.incomingSecurity ?? ("ssl_tls" as AccountSummary["incomingSecurity"])
  });
  const [smtpForm, setSmtpForm] = useState({
    outgoingServer: selectedAccount?.outgoingServer ?? "",
    outgoingPort: selectedAccount?.outgoingPort ?? 465,
    outgoingSecurity: selectedAccount?.outgoingSecurity ?? ("ssl_tls" as AccountSummary["outgoingSecurity"])
  });
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences);
  const [savingName, setSavingName] = useState(false);
  const [savingImap, setSavingImap] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    if (!selectedAccount) return;
    setDisplayName(selectedAccount.name);
    setImapForm({
      incomingServer: selectedAccount.incomingServer,
      incomingPort: selectedAccount.incomingPort,
      incomingSecurity: selectedAccount.incomingSecurity
    });
    setSmtpForm({
      outgoingServer: selectedAccount.outgoingServer,
      outgoingPort: selectedAccount.outgoingPort,
      outgoingSecurity: selectedAccount.outgoingSecurity
    });
  }, [selectedAccount?.id]);

  useEffect(() => {
    if (!window.desktopApi) return;
    void window.desktopApi.getPreferences().then((result) => {
      if (result.ok) setPreferences(result.data);
    });
  }, []);

  const runWorkspaceAction = async (
    action: Promise<{ ok: boolean; error?: string; data?: WorkspaceSnapshot }>,
    notice: string,
    setSaving: (v: boolean) => void
  ) => {
    setSaving(true);
    try {
      const result = await action;
      if (!result.ok || !result.data) throw new Error(result.error ?? "Update failed.");
      onWorkspaceChange(result.data);
      onNotice(notice);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  const requireApi = (): typeof window.desktopApi => {
    if (!window.desktopApi) {
      onError("This requires the Electron desktop shell.");
      return undefined;
    }
    return window.desktopApi;
  };

  const tabs = [
    { id: "account" as const, label: "Account" },
    { id: "signature" as const, label: "Signature" },
    { id: "notifications" as const, label: "Notifications" },
    { id: "about" as const, label: "About" }
  ];

  return (
    <article className="reader-card settings-panel">
      <header className="pane-header settings-header">
        <div>
          <span className="eyebrow eyebrow-inverse">Settings</span>
          <h2 className="pane-folder-name" style={{ marginTop: 6 }}>
            {selectedAccount?.name ?? "Account settings"}
          </h2>
        </div>
        {selectedAccount ? (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <span className={accountClassMap[selectedAccount.status]}>{selectedAccount.status}</span>
            <span className={environmentClassMap[environment]}>{environment}</span>
          </div>
        ) : null}
      </header>

      {selectedAccount ? (
        <div className="settings-scroll">
          <div className="settings-tabbar">
            {tabs.map((tab) => (
              <button
                className={activeTab === tab.id ? "settings-tab settings-tab-active" : "settings-tab"}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Account Tab ─────────────────────────────────────── */}
          {activeTab === "account" ? (
            <section className="settings-grid settings-grid-single">
              {/* Identity */}
              <div className="settings-card">
                <span className="eyebrow eyebrow-inverse">Identity</span>
                <div className="settings-form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <label className="field">
                    <span>Display name</span>
                    <input onChange={(e) => setDisplayName(e.target.value)} value={displayName} />
                  </label>
                  <label className="field">
                    <span>Email address</span>
                    <input disabled value={selectedAccount.address} />
                  </label>
                </div>
                <div className="settings-inline-actions">
                  <button
                    className="primary-button"
                    disabled={savingName}
                    onClick={() => {
                      const api = requireApi();
                      if (!api) return;
                      void runWorkspaceAction(
                        api.updateAccountDisplayName({ accountId: selectedAccount.id, name: displayName }),
                        "Display name updated.",
                        setSavingName
                      );
                    }}
                    type="button"
                  >
                    {savingName ? "Saving…" : "Save name"}
                  </button>
                </div>
              </div>

              {/* IMAP */}
              <div className="settings-card">
                <span className="eyebrow eyebrow-inverse">Incoming IMAP</span>
                <div className="settings-form-grid">
                  <label className="field">
                    <span>Host</span>
                    <input
                      onChange={(e) => setImapForm((c) => ({ ...c, incomingServer: e.target.value }))}
                      value={imapForm.incomingServer}
                    />
                  </label>
                  <label className="field">
                    <span>Port</span>
                    <input
                      max={65535}
                      min={1}
                      onChange={(e) => setImapForm((c) => ({ ...c, incomingPort: Number(e.target.value) || 0 }))}
                      type="number"
                      value={imapForm.incomingPort}
                    />
                  </label>
                  <label className="field">
                    <span>Security</span>
                    <select
                      onChange={(e) =>
                        setImapForm((c) => ({ ...c, incomingSecurity: e.target.value as AccountSummary["incomingSecurity"] }))
                      }
                      value={imapForm.incomingSecurity}
                    >
                      <option value="ssl_tls">SSL/TLS</option>
                      <option value="starttls">STARTTLS</option>
                      <option value="plain">Plain</option>
                    </select>
                  </label>
                </div>
                <div className="settings-inline-actions">
                  <button
                    className="primary-button"
                    disabled={savingImap}
                    onClick={() => {
                      const api = requireApi();
                      if (!api) return;
                      void runWorkspaceAction(
                        api.updateAccountImap({ accountId: selectedAccount.id, ...imapForm }),
                        "IMAP settings updated.",
                        setSavingImap
                      );
                    }}
                    type="button"
                  >
                    {savingImap ? "Saving…" : "Save IMAP"}
                  </button>
                </div>
              </div>

              {/* SMTP */}
              <div className="settings-card">
                <span className="eyebrow eyebrow-inverse">Outgoing SMTP</span>
                <div className="settings-form-grid">
                  <label className="field">
                    <span>Host</span>
                    <input
                      onChange={(e) => setSmtpForm((c) => ({ ...c, outgoingServer: e.target.value }))}
                      value={smtpForm.outgoingServer}
                    />
                  </label>
                  <label className="field">
                    <span>Port</span>
                    <input
                      max={65535}
                      min={1}
                      onChange={(e) => setSmtpForm((c) => ({ ...c, outgoingPort: Number(e.target.value) || 0 }))}
                      type="number"
                      value={smtpForm.outgoingPort}
                    />
                  </label>
                  <label className="field">
                    <span>Security</span>
                    <select
                      onChange={(e) =>
                        setSmtpForm((c) => ({ ...c, outgoingSecurity: e.target.value as AccountSummary["outgoingSecurity"] }))
                      }
                      value={smtpForm.outgoingSecurity}
                    >
                      <option value="ssl_tls">SSL/TLS</option>
                      <option value="starttls">STARTTLS</option>
                      <option value="plain">Plain</option>
                    </select>
                  </label>
                </div>
                <div className="settings-inline-actions">
                  <button
                    className="primary-button"
                    disabled={savingSmtp}
                    onClick={() => {
                      const api = requireApi();
                      if (!api) return;
                      void runWorkspaceAction(
                        api.updateAccountSmtp({ accountId: selectedAccount.id, ...smtpForm }),
                        "SMTP settings updated.",
                        setSavingSmtp
                      );
                    }}
                    type="button"
                  >
                    {savingSmtp ? "Saving…" : "Save SMTP"}
                  </button>
                </div>
              </div>

              {/* Password & Verification */}
              <div className="settings-card">
                <span className="eyebrow eyebrow-inverse">Authentication</span>
                <div className="settings-inline-actions">
                  <button
                    className="secondary-button"
                    disabled={verifyingAccountId === selectedAccount.id}
                    onClick={() => onVerifyAccount(selectedAccount.id)}
                    type="button"
                  >
                    {verifyingAccountId === selectedAccount.id ? "Verifying…" : "Verify & sync"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setShowPasswordForm((c) => !c)}
                    type="button"
                  >
                    {showPasswordForm ? "Cancel" : "Change password"}
                  </button>
                </div>

                {showPasswordForm ? (
                  <div className="settings-inline-form">
                    <div className="settings-form-grid">
                      <label className="field">
                        <span>Current password</span>
                        <input
                          onChange={(e) => setPasswordForm((c) => ({ ...c, currentPassword: e.target.value }))}
                          type="password"
                          value={passwordForm.currentPassword}
                        />
                      </label>
                      <label className="field">
                        <span>New password</span>
                        <input
                          onChange={(e) => setPasswordForm((c) => ({ ...c, newPassword: e.target.value }))}
                          type="password"
                          value={passwordForm.newPassword}
                        />
                      </label>
                      <label className="field">
                        <span>Confirm new password</span>
                        <input
                          onChange={(e) => setPasswordForm((c) => ({ ...c, confirmPassword: e.target.value }))}
                          type="password"
                          value={passwordForm.confirmPassword}
                        />
                      </label>
                    </div>
                    <div className="settings-inline-actions">
                      <button
                        className="primary-button"
                        disabled={savingPassword}
                        onClick={() => {
                          const api = requireApi();
                          if (!api) return;
                          if (passwordForm.newPassword !== passwordForm.confirmPassword) {
                            onError("New passwords do not match.");
                            return;
                          }
                          void runWorkspaceAction(
                            api.reauthAccount({ accountId: selectedAccount.id, password: passwordForm.newPassword }),
                            "Password updated.",
                            setSavingPassword
                          ).then(() => {
                            setShowPasswordForm(false);
                            setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
                          }).catch(() => { /* errors handled inside runWorkspaceAction */ });
                        }}
                        type="button"
                      >
                        {savingPassword ? "Saving…" : "Save password"}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="settings-meta-copy" style={{ marginTop: 4 }}>
                  Last sync: {selectedAccount.lastSync} · Storage: {selectedAccount.storage} · Platform: {formatPlatform(platform)}
                </div>
              </div>

              {/* Danger zone */}
              <div className="settings-card" style={{ borderColor: "rgba(239,68,68,0.18)" }}>
                <span className="eyebrow eyebrow-inverse">Danger zone</span>
                <p>Permanently remove this account and all its cached data from DejAzmach.</p>
                <div className="settings-inline-actions">
                  <button
                    className="btn-action btn-action-danger"
                    disabled={deletingAccount}
                    onClick={() => {
                      const api = requireApi();
                      if (!api) return;
                      if (!window.confirm(`Delete ${selectedAccount.address}? This cannot be undone.`)) return;
                      void runWorkspaceAction(
                        api.deleteAccount(selectedAccount.id),
                        "Account deleted.",
                        setDeletingAccount
                      );
                    }}
                    type="button"
                  >
                    {deletingAccount ? "Deleting…" : "Delete account"}
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {/* ── Signature Tab ────────────────────────────────────── */}
          {activeTab === "signature" ? (
            <section className="settings-grid settings-grid-single">
              <SignatureEditor accountId={selectedAccount.id} onSaved={onSignatureSaved} />
            </section>
          ) : null}

          {/* ── Notifications Tab ────────────────────────────────── */}
          {activeTab === "notifications" ? (
            <section className="settings-grid settings-grid-single">
              <div className="settings-card">
                <span className="eyebrow eyebrow-inverse">Background sync</span>
                <label className="field field-full">
                  <span>Check for new mail every</span>
                  <select
                    onChange={(e) =>
                      setPreferences((c) => ({
                        ...c,
                        syncIntervalMinutes: Number(e.target.value) as NotificationPreferences["syncIntervalMinutes"]
                      }))
                    }
                    value={preferences.syncIntervalMinutes}
                  >
                    <option value={1}>1 minute</option>
                    <option value={5}>5 minutes</option>
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={60}>60 minutes</option>
                  </select>
                </label>
              </div>

              <div className="settings-card">
                <span className="eyebrow eyebrow-inverse">Alerts</span>
                <label className="toggle-row">
                  <span>Desktop notifications for new mail</span>
                  <input
                    checked={preferences.desktopNotifications}
                    onChange={(e) => setPreferences((c) => ({ ...c, desktopNotifications: e.target.checked }))}
                    type="checkbox"
                  />
                </label>
                <label className="toggle-row">
                  <span>Sound alert on new message</span>
                  <input
                    checked={preferences.soundAlert}
                    onChange={(e) => setPreferences((c) => ({ ...c, soundAlert: e.target.checked }))}
                    type="checkbox"
                  />
                </label>
                <label className="toggle-row">
                  <span>Show unread badge on taskbar icon</span>
                  <input
                    checked={preferences.badgeCount}
                    onChange={(e) => setPreferences((c) => ({ ...c, badgeCount: e.target.checked }))}
                    type="checkbox"
                  />
                </label>
                <div className="settings-inline-actions" style={{ paddingTop: 4 }}>
                  <button
                    className="primary-button"
                    disabled={savingPrefs}
                    onClick={() => {
                      const api = requireApi();
                      if (!api) return;
                      setSavingPrefs(true);
                      void api.setPreferences(preferences)
                        .then((result) => {
                          if (!result.ok) throw new Error(result.error);
                          onNotice("Preferences saved.");
                        })
                        .catch((error) => onError(error instanceof Error ? error.message : "Save failed."))
                        .finally(() => setSavingPrefs(false));
                    }}
                    type="button"
                  >
                    {savingPrefs ? "Saving…" : "Save preferences"}
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {/* ── About Tab ────────────────────────────────────────── */}
          {activeTab === "about" ? (
            <section className="settings-grid settings-grid-single">
              <div className="settings-card">
                <span className="eyebrow eyebrow-inverse">About</span>
                <h3>DejAzmach</h3>
                <p>A secure, local-first desktop mail client built on Electron.</p>
                <dl className="settings-list">
                  <div>
                    <dt>Version</dt>
                    <dd>{version}</dd>
                  </div>
                  <div>
                    <dt>Platform</dt>
                    <dd>{formatPlatform(platform)}</dd>
                  </div>
                  <div>
                    <dt>Environment</dt>
                    <dd>
                      <span className={environmentClassMap[environment]}>{environment}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Stack</dt>
                    <dd>Electron · React 18 · TypeScript 5 · SQLite</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>
                      <a className="settings-link" href="https://github.com/" rel="noreferrer" target="_blank">
                        GitHub
                      </a>
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="settings-card">
                <span className="eyebrow eyebrow-inverse">Security</span>
                <h3>Local-first & private</h3>
                <p>
                  All mail is stored locally in an encrypted SQLite database. No data is sent to third-party servers.
                  HTML email content is sanitized before rendering.
                </p>
                <dl className="settings-list">
                  <div>
                    <dt>Transport</dt>
                    <dd>IMAP / SMTP (direct)</dd>
                  </div>
                  <div>
                    <dt>Credential storage</dt>
                    <dd>Electron safeStorage (OS keychain)</dd>
                  </div>
                  <div>
                    <dt>HTML sanitizer</dt>
                    <dd>DOMPurify</dd>
                  </div>
                  <div>
                    <dt>Renderer process</dt>
                    <dd>Context-isolated, sandboxed</dd>
                  </div>
                </dl>
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="empty-panel">
          <div className="empty-panel-icon" aria-hidden="true">⚙</div>
          <h3>No account selected</h3>
          <p>Select a mailbox from the sidebar to manage its settings.</p>
        </div>
      )}
    </article>
  );
}
