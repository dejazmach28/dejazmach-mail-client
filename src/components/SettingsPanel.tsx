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
  if (!platform) {
    return "Unknown";
  }

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
    incomingSecurity: selectedAccount?.incomingSecurity ?? "ssl_tls"
  });
  const [smtpForm, setSmtpForm] = useState({
    outgoingServer: selectedAccount?.outgoingServer ?? "",
    outgoingPort: selectedAccount?.outgoingPort ?? 465,
    outgoingSecurity: selectedAccount?.outgoingSecurity ?? "ssl_tls"
  });
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences);

  useEffect(() => {
    if (!selectedAccount) {
      return;
    }

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
  }, [selectedAccount]);

  useEffect(() => {
    if (!window.desktopApi) {
      return;
    }

    void window.desktopApi.getPreferences().then((result) => {
      if (result.ok) {
        setPreferences(result.data);
      }
    });
  }, []);

  const runWorkspaceAction = async (action: Promise<{ ok: boolean; error?: string; data?: WorkspaceSnapshot }>, notice: string) => {
    const result = await action;
    if (!result.ok || !result.data) {
      throw new Error(result.error ?? "Settings update failed.");
    }

    onWorkspaceChange(result.data);
    onNotice(notice);
  };

  return (
    <article className="reader-card settings-panel">
      <header className="pane-header settings-header">
        <div>
          <span className="eyebrow">Settings</span>
          <h2>{selectedAccount?.name ?? "Account settings"}</h2>
        </div>
      </header>

      {selectedAccount ? (
        <div className="settings-scroll">
          <div className="settings-tabbar">
            {(["account", "signature", "notifications", "about"] as const).map((tab) => (
              <button
                className={activeTab === tab ? "settings-tab settings-tab-active" : "settings-tab"}
                key={tab}
                onClick={() => setActiveTab(tab)}
                type="button"
              >
                {tab === "account" ? "Account" : tab === "signature" ? "Signature" : tab === "notifications" ? "Notifications" : "About"}
              </button>
            ))}
          </div>

          {activeTab === "account" ? (
            <section className="settings-grid settings-grid-single">
              <div className="settings-card">
                <span className="eyebrow">Account</span>
                <div className="settings-badges">
                  <span className={accountClassMap[selectedAccount.status]}>{selectedAccount.status}</span>
                  <span className={environmentClassMap[environment]}>{environment}</span>
                </div>
                <label className="field field-full">
                  <span>Display name</span>
                  <input onChange={(event) => setDisplayName(event.target.value)} value={displayName} />
                </label>
                <label className="field field-full">
                  <span>Email address</span>
                  <input disabled value={selectedAccount.address} />
                </label>
                <div className="settings-form-grid">
                  <label className="field">
                    <span>IMAP host</span>
                    <input
                      onChange={(event) => setImapForm((current) => ({ ...current, incomingServer: event.target.value }))}
                      value={imapForm.incomingServer}
                    />
                  </label>
                  <label className="field">
                    <span>Port</span>
                    <input
                      onChange={(event) =>
                        setImapForm((current) => ({ ...current, incomingPort: Number(event.target.value) || 0 }))
                      }
                      type="number"
                      value={imapForm.incomingPort}
                    />
                  </label>
                  <label className="field">
                    <span>Security</span>
                    <select
                      onChange={(event) =>
                        setImapForm((current) => ({
                          ...current,
                          incomingSecurity: event.target.value as AccountSummary["incomingSecurity"]
                        }))
                      }
                      value={imapForm.incomingSecurity}
                    >
                      <option value="ssl_tls">SSL/TLS</option>
                      <option value="starttls">STARTTLS</option>
                      <option value="plain">Plain</option>
                    </select>
                  </label>
                </div>
                <div className="settings-form-grid">
                  <label className="field">
                    <span>SMTP host</span>
                    <input
                      onChange={(event) => setSmtpForm((current) => ({ ...current, outgoingServer: event.target.value }))}
                      value={smtpForm.outgoingServer}
                    />
                  </label>
                  <label className="field">
                    <span>Port</span>
                    <input
                      onChange={(event) =>
                        setSmtpForm((current) => ({ ...current, outgoingPort: Number(event.target.value) || 0 }))
                      }
                      type="number"
                      value={smtpForm.outgoingPort}
                    />
                  </label>
                  <label className="field">
                    <span>Security</span>
                    <select
                      onChange={(event) =>
                        setSmtpForm((current) => ({
                          ...current,
                          outgoingSecurity: event.target.value as AccountSummary["outgoingSecurity"]
                        }))
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
                    onClick={() => {
                      if (!window.desktopApi) {
                        onError("Settings updates require the Electron desktop shell.");
                        return;
                      }

                      void runWorkspaceAction(
                        window.desktopApi.updateAccountDisplayName({
                          accountId: selectedAccount.id,
                          name: displayName
                        }),
                        "Display name updated."
                      ).catch((error) => onError(error instanceof Error ? error.message : "Display name update failed."));
                    }}
                    type="button"
                  >
                    Save name
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => {
                      if (!window.desktopApi) {
                        onError("Settings updates require the Electron desktop shell.");
                        return;
                      }

                      void runWorkspaceAction(
                        window.desktopApi.updateAccountImap({
                          accountId: selectedAccount.id,
                          incomingServer: imapForm.incomingServer,
                          incomingPort: imapForm.incomingPort,
                          incomingSecurity: imapForm.incomingSecurity
                        }),
                        "IMAP settings updated."
                      ).catch((error) => onError(error instanceof Error ? error.message : "IMAP update failed."));
                    }}
                    type="button"
                  >
                    Save IMAP
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => {
                      if (!window.desktopApi) {
                        onError("Settings updates require the Electron desktop shell.");
                        return;
                      }

                      void runWorkspaceAction(
                        window.desktopApi.updateAccountSmtp({
                          accountId: selectedAccount.id,
                          outgoingServer: smtpForm.outgoingServer,
                          outgoingPort: smtpForm.outgoingPort,
                          outgoingSecurity: smtpForm.outgoingSecurity
                        }),
                        "SMTP settings updated."
                      ).catch((error) => onError(error instanceof Error ? error.message : "SMTP update failed."));
                    }}
                    type="button"
                  >
                    Save SMTP
                  </button>
                  <button className="secondary-button" onClick={() => setShowPasswordForm((current) => !current)} type="button">
                    Change password
                  </button>
                  <button
                    className="btn-action-danger"
                    onClick={() => {
                      if (!window.desktopApi) {
                        onError("Account deletion requires the Electron desktop shell.");
                        return;
                      }

                      if (!window.confirm(`Delete ${selectedAccount.address}?`)) {
                        return;
                      }

                      void runWorkspaceAction(
                        window.desktopApi.deleteAccount(selectedAccount.id),
                        "Account deleted."
                      ).catch((error) => onError(error instanceof Error ? error.message : "Account delete failed."));
                    }}
                    type="button"
                  >
                    Delete account
                  </button>
                </div>

                {showPasswordForm ? (
                  <div className="settings-inline-form">
                    <div className="settings-form-grid">
                      <label className="field">
                        <span>Current password</span>
                        <input
                          onChange={(event) =>
                            setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))
                          }
                          type="password"
                          value={passwordForm.currentPassword}
                        />
                      </label>
                      <label className="field">
                        <span>New password</span>
                        <input
                          onChange={(event) =>
                            setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))
                          }
                          type="password"
                          value={passwordForm.newPassword}
                        />
                      </label>
                      <label className="field">
                        <span>Confirm password</span>
                        <input
                          onChange={(event) =>
                            setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))
                          }
                          type="password"
                          value={passwordForm.confirmPassword}
                        />
                      </label>
                    </div>
                    <div className="settings-inline-actions">
                      <button
                        className="primary-button"
                        onClick={() => {
                          if (!window.desktopApi) {
                            onError("Password updates require the Electron desktop shell.");
                            return;
                          }

                          if (passwordForm.newPassword !== passwordForm.confirmPassword) {
                            onError("New passwords do not match.");
                            return;
                          }

                          void runWorkspaceAction(
                            window.desktopApi.reauthAccount({
                              accountId: selectedAccount.id,
                              password: passwordForm.newPassword
                            }),
                            "Password updated."
                          )
                            .then(() => {
                              setShowPasswordForm(false);
                              setPasswordForm({
                                currentPassword: "",
                                newPassword: "",
                                confirmPassword: ""
                              });
                            })
                            .catch((error) => onError(error instanceof Error ? error.message : "Password update failed."));
                        }}
                        type="button"
                      >
                        Save password
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="settings-inline-actions">
                  <button
                    className="secondary-button"
                    disabled={verifyingAccountId === selectedAccount.id}
                    onClick={() => onVerifyAccount(selectedAccount.id)}
                    type="button"
                  >
                    {verifyingAccountId === selectedAccount.id ? "Verifying..." : "Verify & sync"}
                  </button>
                  <span className="settings-meta-copy">
                    Storage: {selectedAccount.storage} · Last sync: {selectedAccount.lastSync} · Platform: {formatPlatform(platform)}
                  </span>
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === "signature" ? (
            <section className="settings-grid settings-grid-single">
              <SignatureEditor accountId={selectedAccount.id} onSaved={onSignatureSaved} />
            </section>
          ) : null}

          {activeTab === "notifications" ? (
            <section className="settings-grid settings-grid-single">
              <div className="settings-card">
                <span className="eyebrow">Notifications</span>
                <h3>Background sync behavior</h3>
                <label className="toggle-row">
                  <span>Desktop notifications for new mail</span>
                  <input
                    checked={preferences.desktopNotifications}
                    onChange={(event) =>
                      setPreferences((current) => ({ ...current, desktopNotifications: event.target.checked }))
                    }
                    type="checkbox"
                  />
                </label>
                <label className="toggle-row">
                  <span>Sound alert</span>
                  <input
                    checked={preferences.soundAlert}
                    onChange={(event) =>
                      setPreferences((current) => ({ ...current, soundAlert: event.target.checked }))
                    }
                    type="checkbox"
                  />
                </label>
                <label className="toggle-row">
                  <span>Badge count on taskbar</span>
                  <input
                    checked={preferences.badgeCount}
                    onChange={(event) =>
                      setPreferences((current) => ({ ...current, badgeCount: event.target.checked }))
                    }
                    type="checkbox"
                  />
                </label>
                <label className="field field-full">
                  <span>Notification preview interval</span>
                  <select
                    onChange={(event) =>
                      setPreferences((current) => ({
                        ...current,
                        syncIntervalMinutes: Number(event.target.value) as NotificationPreferences["syncIntervalMinutes"]
                      }))
                    }
                    value={preferences.syncIntervalMinutes}
                  >
                    <option value={1}>Every 1 min</option>
                    <option value={5}>Every 5 min</option>
                    <option value={15}>Every 15 min</option>
                    <option value={30}>Every 30 min</option>
                    <option value={60}>Every 60 min</option>
                  </select>
                </label>
                <div className="settings-inline-actions">
                  <button
                    className="primary-button"
                    onClick={() => {
                      if (!window.desktopApi) {
                        onError("Preference updates require the Electron desktop shell.");
                        return;
                      }

                      void window.desktopApi
                        .setPreferences(preferences)
                        .then((result) => {
                          if (!result.ok) {
                            throw new Error(result.error);
                          }
                          onNotice("Notification preferences saved.");
                        })
                        .catch((error) =>
                          onError(error instanceof Error ? error.message : "Preference update failed.")
                        );
                    }}
                    type="button"
                  >
                    Save
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === "about" ? (
            <section className="settings-grid settings-grid-single">
              <div className="settings-card">
                <span className="eyebrow">About</span>
                <h3>DejAzmach</h3>
                <p>Secure Desktop Mail Client</p>
                <dl className="settings-list">
                  <div>
                    <dt>Version</dt>
                    <dd>{version}</dd>
                  </div>
                  <div>
                    <dt>Tech stack</dt>
                    <dd>Electron 35, React 18, TypeScript 5</dd>
                  </div>
                  <div>
                    <dt>Platform</dt>
                    <dd>{formatPlatform(platform)}</dd>
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
            </section>
          ) : null}
        </div>
      ) : (
        <div className="empty-panel">
          <h3>No account selected.</h3>
          <p>Select a mailbox from the left rail.</p>
        </div>
      )}
    </article>
  );
}
