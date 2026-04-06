import { useEffect, useState } from "react";
import type {
  AccountStatus,
  CreateAccountInput,
  CreateDraftInput,
  LedgerSeverity,
  MailTrust,
  ReleaseTarget,
  RuntimeEnvironment,
  SecurityStatus,
  SyncStatus,
  WorkspaceSnapshot
} from "../shared/contracts.js";

const securityClassMap: Record<SecurityStatus, string> = {
  active: "status-pill status-pill-active",
  monitoring: "status-pill status-pill-monitoring",
  idle: "status-pill status-pill-idle"
};

const accountClassMap: Record<AccountStatus, string> = {
  online: "status-pill status-pill-active",
  syncing: "status-pill status-pill-monitoring",
  attention: "status-pill status-pill-critical"
};

const trustClassMap: Record<MailTrust, string> = {
  trusted: "mini-pill mini-pill-neutral",
  encrypted: "mini-pill mini-pill-success",
  review: "mini-pill mini-pill-warning"
};

const syncClassMap: Record<SyncStatus, string> = {
  complete: "mini-pill mini-pill-neutral",
  running: "mini-pill mini-pill-success",
  queued: "mini-pill mini-pill-warning"
};

const ledgerClassMap: Record<LedgerSeverity, string> = {
  info: "mini-pill mini-pill-neutral",
  notice: "mini-pill mini-pill-warning",
  critical: "mini-pill mini-pill-critical"
};

const environmentClassMap: Record<RuntimeEnvironment, string> = {
  development: "mini-pill mini-pill-warning",
  production: "mini-pill mini-pill-success"
};

const releaseTargetClassMap: Record<ReleaseTarget["status"], string> = {
  configured: "mini-pill mini-pill-success",
  pending: "mini-pill mini-pill-warning"
};

const initialAccountForm: CreateAccountInput = {
  name: "",
  address: "",
  provider: "IMAP",
  username: "",
  password: "",
  incomingServer: "",
  incomingPort: 993,
  outgoingServer: "",
  outgoingPort: 465
};

const browserPreviewWorkspace: WorkspaceSnapshot = {
  shellState: {
    appName: "DejAzmach",
    version: "preview",
    platform: "browser",
    environment: "development",
    packaged: false,
    secureDesktopMode: true,
    releaseTargets: [
      {
        os: "linux",
        formats: ["AppImage", "deb"],
        status: "configured",
        note: "Preview data mirrors the intended desktop release matrix."
      }
    ],
    capabilities: [
      "Renderer preview contract",
      "Desktop load-state UI",
      "Security-first shell messaging"
    ],
    securityMetrics: [
      {
        label: "Renderer isolation",
        value: "Preview contract",
        status: "active",
        detail: "Browser mode mirrors the intended Electron boundary while the UI is being developed."
      },
      {
        label: "Credential storage",
        value: "Pending OS vault",
        status: "monitoring",
        detail: "Real secret handling belongs in the main process with operating-system-backed storage."
      }
    ],
    transparencyLedger: [
      {
        id: "preview-1",
        title: "Browser preview data",
        detail: "The renderer is showing local sample data because Electron preload is not active in a plain browser tab.",
        occurredAt: "Preview",
        severity: "notice"
      }
    ]
  },
  accounts: [
    {
      id: "preview-account",
      name: "Preview",
      address: "preview@dejazmach.app",
      provider: "Local",
      status: "online",
      lastSync: "local",
      unreadCount: 1,
      storage: "mock"
    }
  ],
  folders: [
    { id: "preview-folder", name: "Priority inbox", count: 1, kind: "priority" },
    { id: "preview-drafts", name: "Shielded drafts", count: 1, kind: "drafts" }
  ],
  messages: [
    {
      id: "preview-message",
      threadId: "preview-thread",
      accountId: "preview-account",
      folderId: "preview-folder",
      sender: "Preview shell",
      subject: "Desktop contract preview",
      preview: "Electron IPC will replace this browser data when the desktop shell is active.",
      label: "Preview",
      time: "Now",
      unread: true,
      trust: "trusted"
    }
  ],
  threads: [
    {
      id: "preview-thread",
      subject: "Desktop contract preview",
      classification: "Preview",
      participants: ["Preview shell"],
      messages: [
        {
          id: "preview-thread-message",
          sender: "Preview shell",
          address: "preview@dejazmach.app",
          sentAt: "Now",
          verified: true,
          body: "Electron preload data replaces this preview when the desktop app is running.",
          contentMode: "plain"
        }
      ]
    }
  ],
  syncJobs: [
    {
      id: "preview-sync",
      title: "Preview mode",
      detail: "No live mail transport is active in browser mode.",
      status: "queued",
      time: "Pending"
    }
  ]
};

const formatPlatform = (platform: string) => {
  if (!platform) {
    return "Unknown";
  }

  return `${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
};

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(browserPreviewWorkspace);
  const [selectedFolderId, setSelectedFolderId] = useState(browserPreviewWorkspace.folders[0]?.id ?? "");
  const [selectedThreadId, setSelectedThreadId] = useState(browserPreviewWorkspace.messages[0]?.threadId ?? "");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(Boolean(window.desktopApi));
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [verifyingAccountId, setVerifyingAccountId] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState<CreateAccountInput>(initialAccountForm);
  const [draftForm, setDraftForm] = useState<CreateDraftInput>({
    accountId: browserPreviewWorkspace.accounts[0]?.id ?? "",
    to: "",
    subject: "",
    body: ""
  });

  const applyWorkspace = (nextWorkspace: WorkspaceSnapshot) => {
    setWorkspace(nextWorkspace);
    setSelectedFolderId((currentFolderId) =>
      nextWorkspace.folders.some((folder) => folder.id === currentFolderId)
        ? currentFolderId
        : (nextWorkspace.folders[0]?.id ?? "")
    );
    setSelectedThreadId((currentThreadId) =>
      nextWorkspace.threads.some((thread) => thread.id === currentThreadId)
        ? currentThreadId
        : (nextWorkspace.messages[0]?.threadId ?? nextWorkspace.threads[0]?.id ?? "")
    );
    setDraftForm((currentDraft) => ({
      ...currentDraft,
      accountId:
        nextWorkspace.accounts.some((account) => account.id === currentDraft.accountId)
          ? currentDraft.accountId
          : (nextWorkspace.accounts[0]?.id ?? "")
    }));
  };

  useEffect(() => {
    if (!window.desktopApi) {
      setIsBooting(false);
      return;
    }

    void window.desktopApi
      .getWorkspaceSnapshot()
      .then((nextWorkspace) => {
        applyWorkspace(nextWorkspace);
      })
      .catch(() => {
        setLoadError("Desktop data could not be loaded. Showing local preview state instead.");
      })
      .finally(() => {
        setIsBooting(false);
      });
  }, []);

  const visibleMessages = (() => {
    const filtered = workspace.messages.filter((message) => message.folderId === selectedFolderId);
    return filtered.length > 0 ? filtered : workspace.messages;
  })();

  const selectedThread =
    workspace.threads.find((thread) => thread.id === selectedThreadId) ??
    workspace.threads.find((thread) => thread.id === visibleMessages[0]?.threadId) ??
    workspace.threads[0];

  const unreadCount = workspace.messages.filter((message) => message.unread).length;
  const runningSyncJobs = workspace.syncJobs.filter((job) => job.status === "running").length;
  const transparencyCount = workspace.shellState.transparencyLedger.length;

  const handleAccountSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError(null);
    setActionNotice(null);

    if (!window.desktopApi) {
      setActionError("Account onboarding requires the Electron desktop shell.");
      return;
    }

    setIsSavingAccount(true);

    try {
      const nextWorkspace = await window.desktopApi.createAccount(accountForm);
      applyWorkspace(nextWorkspace);
      setAccountForm(initialAccountForm);
      setActionNotice(`Stored ${accountForm.address} in the local account vault.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Account onboarding failed.");
    } finally {
      setIsSavingAccount(false);
    }
  };

  const handleDraftSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError(null);
    setActionNotice(null);

    if (!window.desktopApi) {
      setActionError("Draft persistence requires the Electron desktop shell.");
      return;
    }

    setIsSavingDraft(true);

    try {
      const nextWorkspace = await window.desktopApi.createDraft(draftForm);
      applyWorkspace(nextWorkspace);
      setSelectedFolderId("folder-drafts");
      const latestDraft = nextWorkspace.messages.find((message) => message.folderId === "folder-drafts");
      if (latestDraft) {
        setSelectedThreadId(latestDraft.threadId);
      }
      setDraftForm((currentDraft) => ({
        ...currentDraft,
        to: "",
        subject: "",
        body: ""
      }));
      setActionNotice("Draft persisted in the local SQLite workspace.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Draft persistence failed.");
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleVerifyAccount = async (accountId: string) => {
    setActionError(null);
    setActionNotice(null);

    if (!window.desktopApi) {
      setActionError("Provider verification requires the Electron desktop shell.");
      return;
    }

    setVerifyingAccountId(accountId);

    try {
      const nextWorkspace = await window.desktopApi.verifyAccount(accountId);
      applyWorkspace(nextWorkspace);
      setSelectedFolderId("folder-security");
      setActionNotice("Provider verification completed.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Provider verification failed.");
    } finally {
      setVerifyingAccountId(null);
    }
  };

  const handleSendMessage = async () => {
    setActionError(null);
    setActionNotice(null);

    if (!window.desktopApi) {
      setActionError("Outbound delivery requires the Electron desktop shell.");
      return;
    }

    setIsSendingMessage(true);

    try {
      const nextWorkspace = await window.desktopApi.sendMessage(draftForm);
      applyWorkspace(nextWorkspace);
      setSelectedFolderId("folder-sent");
      const latestSent = nextWorkspace.messages.find((message) => message.folderId === "folder-sent");
      if (latestSent) {
        setSelectedThreadId(latestSent.threadId);
      }
      setDraftForm((currentDraft) => ({
        ...currentDraft,
        to: "",
        subject: "",
        body: ""
      }));
      setActionNotice("Message submitted through the provider SMTP transport.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Message delivery failed.");
    } finally {
      setIsSendingMessage(false);
    }
  };

  return (
    <main className="app-shell">
      {isBooting ? (
        <div className="boot-overlay" aria-live="polite">
          <div className="boot-card glass-card">
            <span className="eyebrow">DejAzmach desktop shell</span>
            <h2>Preparing secure workspace</h2>
            <p>
              Loading the renderer inside a restricted Electron boundary. Navigation, remote requests,
              and unmanaged downloads stay denied while the shell starts.
            </p>
          </div>
        </div>
      ) : null}

      <section className="top-banner">
        <article className="glass-card hero-card">
          <div className="hero-copy">
            <span className="eyebrow">DejAzmach secure desktop mail</span>
            <h1>Mail that exposes its trust surface.</h1>
            <p>
              A desktop-first foundation for a serious mail client: strong Electron boundaries,
              visible account and sync state, persisted local workspace data, and a transparency
              ledger that explains what the app is doing instead of asking the user to assume.
            </p>
          </div>

          <div className="hero-metrics">
            <div className="metric-card">
              <span className="card-label">Secure desktop mode</span>
              <strong>{workspace.shellState.secureDesktopMode ? "Enabled" : "Unavailable"}</strong>
              <p>Renderer APIs are reduced to a typed preload contract.</p>
            </div>

            <div className="metric-card accent-card">
              <span className="card-label">Unread priority</span>
              <strong>{unreadCount} messages</strong>
              <p>Unread and security-sensitive mail stays visible from the first screen.</p>
            </div>

            <div className="metric-card">
              <span className="card-label">Transparency events</span>
              <strong>{transparencyCount} entries</strong>
              <p>Every trust-relevant behavior should become inspectable product state.</p>
            </div>
          </div>
        </article>

        <article className="glass-card command-card">
          <div className="section-heading">
            <div>
              <span className="card-label">System</span>
              <h2>Shell posture</h2>
            </div>
            <span className="status-pill status-pill-active">desktop</span>
          </div>

          <div className="command-list">
            <div>
              <span className="card-label">Platform</span>
              <strong>{formatPlatform(workspace.shellState.platform)}</strong>
            </div>
            <div>
              <span className="card-label">Version</span>
              <strong>{workspace.shellState.version}</strong>
            </div>
            <div>
              <span className="card-label">Runtime</span>
              <strong>{workspace.shellState.packaged ? "Packaged build" : "Developer shell"}</strong>
            </div>
            <div>
              <span className="card-label">Live sync jobs</span>
              <strong>{runningSyncJobs}</strong>
            </div>
          </div>

          <div className="command-pills">
            <span className={environmentClassMap[workspace.shellState.environment]}>
              {workspace.shellState.environment}
            </span>
            <span className="mini-pill mini-pill-neutral">{formatPlatform(workspace.shellState.platform)}</span>
          </div>

          {loadError ? <p className="inline-notice">{loadError}</p> : null}
          {actionError ? <p className="inline-notice inline-notice-critical">{actionError}</p> : null}
          {actionNotice ? <p className="inline-notice inline-notice-success">{actionNotice}</p> : null}
        </article>
      </section>

      <section className="desktop-grid">
        <aside className="glass-card sidebar">
          <section>
            <span className="card-label">Accounts</span>
            <h2>Command deck</h2>
            <div className="account-list">
              {workspace.accounts.map((account) => (
                <article className="account-card" key={account.id}>
                  <div className="account-topline">
                    <div>
                      <strong>{account.name}</strong>
                      <p>{account.address}</p>
                    </div>
                    <span className={accountClassMap[account.status]}>{account.status}</span>
                  </div>
                  <div className="account-meta">
                    <span>{account.provider}</span>
                    <span>{account.unreadCount} unread</span>
                  </div>
                  <p className="account-footnote">
                    Last sync {account.lastSync}. Storage: {account.storage}.
                  </p>
                  <button
                    className="secondary-button"
                    disabled={verifyingAccountId === account.id}
                    onClick={() => void handleVerifyAccount(account.id)}
                    type="button"
                  >
                    {verifyingAccountId === account.id ? "Verifying..." : "Verify & sync"}
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section>
            <span className="card-label">Folders</span>
            <div className="folder-list" aria-label="Folders">
              {workspace.folders.map((folder) => (
                <button
                  className={folder.id === selectedFolderId ? "folder-button folder-button-active" : "folder-button"}
                  key={folder.id}
                  onClick={() => {
                    setSelectedFolderId(folder.id);
                    const nextMessage = workspace.messages.find((message) => message.folderId === folder.id);
                    if (nextMessage) {
                      setSelectedThreadId(nextMessage.threadId);
                    }
                  }}
                  type="button"
                >
                  <span>{folder.name}</span>
                  <span>{folder.count}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="form-card">
            <div className="section-heading">
              <div>
                <span className="card-label">Account onboarding</span>
                <h2>Local vault</h2>
              </div>
            </div>

            <form className="stack-form" onSubmit={handleAccountSubmit}>
              <div className="form-grid">
                <label className="field">
                  <span>Name</span>
                  <input
                    onChange={(event) => setAccountForm((current) => ({ ...current, name: event.target.value }))}
                    required
                    value={accountForm.name}
                  />
                </label>
                <label className="field">
                  <span>Address</span>
                  <input
                    onChange={(event) => setAccountForm((current) => ({ ...current, address: event.target.value }))}
                    required
                    type="email"
                    value={accountForm.address}
                  />
                </label>
                <label className="field">
                  <span>Provider</span>
                  <input
                    onChange={(event) => setAccountForm((current) => ({ ...current, provider: event.target.value }))}
                    required
                    value={accountForm.provider}
                  />
                </label>
                <label className="field">
                  <span>Username</span>
                  <input
                    onChange={(event) => setAccountForm((current) => ({ ...current, username: event.target.value }))}
                    required
                    value={accountForm.username}
                  />
                </label>
                <label className="field">
                  <span>Incoming host</span>
                  <input
                    onChange={(event) => setAccountForm((current) => ({ ...current, incomingServer: event.target.value }))}
                    required
                    value={accountForm.incomingServer}
                  />
                </label>
                <label className="field">
                  <span>Outgoing host</span>
                  <input
                    onChange={(event) => setAccountForm((current) => ({ ...current, outgoingServer: event.target.value }))}
                    required
                    value={accountForm.outgoingServer}
                  />
                </label>
                <label className="field">
                  <span>Incoming port</span>
                  <input
                    min={1}
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, incomingPort: Number(event.target.value) || 0 }))
                    }
                    required
                    type="number"
                    value={accountForm.incomingPort}
                  />
                </label>
                <label className="field">
                  <span>Outgoing port</span>
                  <input
                    min={1}
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, outgoingPort: Number(event.target.value) || 0 }))
                    }
                    required
                    type="number"
                    value={accountForm.outgoingPort}
                  />
                </label>
              </div>

              <label className="field">
                <span>Password</span>
                <input
                  onChange={(event) => setAccountForm((current) => ({ ...current, password: event.target.value }))}
                  required
                  type="password"
                  value={accountForm.password}
                />
              </label>

              <button className="primary-button" disabled={isSavingAccount} type="submit">
                {isSavingAccount ? "Storing account..." : "Store in local vault"}
              </button>
            </form>
          </section>
        </aside>

        <section className="glass-card inbox-panel">
          <header className="section-heading">
            <div>
              <span className="card-label">Inbox</span>
              <h2>Visible operations</h2>
            </div>
            <span className="mini-pill mini-pill-neutral">{visibleMessages.length} threads</span>
          </header>

          <div className="message-list">
            {visibleMessages.map((message) => (
              <button
                className={message.threadId === selectedThread?.id ? "message-card message-card-active" : "message-card"}
                key={message.id}
                onClick={() => setSelectedThreadId(message.threadId)}
                type="button"
              >
                <div className="message-topline">
                  <strong>{message.sender}</strong>
                  <span>{message.time}</span>
                </div>
                <h3>
                  {message.subject}
                  {message.unread ? <span className="unread-dot" aria-hidden="true" /> : null}
                </h3>
                <p>{message.preview}</p>
                <div className="message-footer">
                  <span className="tag">{message.label}</span>
                  <span className={trustClassMap[message.trust]}>{message.trust}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="detail-stack">
          <article className="glass-card thread-card">
            <header className="section-heading">
              <div>
                <span className="card-label">Thread</span>
                <h2>{selectedThread?.subject ?? "No thread selected"}</h2>
              </div>
              {selectedThread ? (
                <span className="mini-pill mini-pill-neutral">{selectedThread.classification}</span>
              ) : null}
            </header>

            <div className="participants">
              {selectedThread?.participants.map((participant) => (
                <span className="participant-chip" key={participant}>
                  {participant}
                </span>
              )) ?? null}
            </div>

            <div className="thread-stream">
              {selectedThread?.messages.map((message) => (
                <article className="thread-message" key={message.id}>
                  <div className="thread-topline">
                    <div>
                      <strong>{message.sender}</strong>
                      <p>{message.address}</p>
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

                  <pre className="thread-body">{message.body}</pre>
                </article>
              )) ?? null}
            </div>
          </article>

          <div className="detail-grid">
            <article className="glass-card security-card">
              <header className="section-heading">
                <div>
                  <span className="card-label">Security posture</span>
                  <h2>Trust surface</h2>
                </div>
              </header>

              <div className="security-list">
                {workspace.shellState.securityMetrics.map((metric) => (
                  <div className="security-row" key={metric.label}>
                    <div>
                      <strong>{metric.label}</strong>
                      <p>{metric.detail}</p>
                    </div>
                    <div className="security-side">
                      <span className={securityClassMap[metric.status]}>{metric.status}</span>
                      <span className="security-value">{metric.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="glass-card sync-card">
              <header className="section-heading">
                <div>
                  <span className="card-label">Compose</span>
                  <h2>Drafts</h2>
                </div>
              </header>

              <form className="stack-form" onSubmit={handleDraftSubmit}>
                <label className="field">
                  <span>Account</span>
                  <select
                    onChange={(event) => setDraftForm((current) => ({ ...current, accountId: event.target.value }))}
                    required
                    value={draftForm.accountId}
                  >
                    {workspace.accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} · {account.address}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>To</span>
                  <input
                    onChange={(event) => setDraftForm((current) => ({ ...current, to: event.target.value }))}
                    placeholder="recipient@example.com"
                    value={draftForm.to}
                  />
                </label>

                <label className="field">
                  <span>Subject</span>
                  <input
                    onChange={(event) => setDraftForm((current) => ({ ...current, subject: event.target.value }))}
                    value={draftForm.subject}
                  />
                </label>

                <label className="field">
                  <span>Body</span>
                  <textarea
                    onChange={(event) => setDraftForm((current) => ({ ...current, body: event.target.value }))}
                    rows={7}
                    value={draftForm.body}
                  />
                </label>

                <button className="primary-button" disabled={isSavingDraft} type="submit">
                  {isSavingDraft ? "Saving draft..." : "Persist draft locally"}
                </button>
                <button
                  className="secondary-button"
                  disabled={isSendingMessage}
                  onClick={() => void handleSendMessage()}
                  type="button"
                >
                  {isSendingMessage ? "Sending..." : "Send now"}
                </button>
              </form>
            </article>
          </div>

          <article className="glass-card ledger-card">
            <header className="section-heading">
              <div>
                <span className="card-label">Transparency</span>
                <h2>Session ledger</h2>
              </div>
            </header>

            <div className="ledger-list">
              {workspace.shellState.transparencyLedger.map((entry) => (
                <article className="ledger-entry" key={entry.id}>
                  <div className="ledger-topline">
                    <div>
                      <strong>{entry.title}</strong>
                      <p>{entry.detail}</p>
                    </div>
                    <div className="security-side">
                      <span className={ledgerClassMap[entry.severity]}>{entry.severity}</span>
                      <span className="security-value">{entry.occurredAt}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <div className="detail-grid">
            <article className="glass-card release-card">
              <header className="section-heading">
                <div>
                  <span className="card-label">Release targets</span>
                  <h2>Cross-platform build</h2>
                </div>
              </header>

              <div className="release-list">
                {workspace.shellState.releaseTargets.map((target) => (
                  <article className="release-row" key={target.os}>
                    <div>
                      <strong>{target.os}</strong>
                      <p>{target.note}</p>
                    </div>
                    <div className="security-side">
                      <span className={releaseTargetClassMap[target.status]}>{target.status}</span>
                      <span className="security-value">{target.formats.join(", ")}</span>
                    </div>
                  </article>
                ))}
              </div>
            </article>

            <article className="glass-card release-card">
              <header className="section-heading">
                <div>
                  <span className="card-label">Shell capabilities</span>
                  <h2>Production foundation</h2>
                </div>
              </header>

              <ul className="capability-list">
                {workspace.shellState.capabilities.map((capability) => (
                  <li key={capability}>{capability}</li>
                ))}
              </ul>
            </article>
          </div>

          <article className="glass-card sync-card">
            <header className="section-heading">
              <div>
                <span className="card-label">Sync</span>
                <h2>Queue state</h2>
              </div>
            </header>

            <div className="sync-list">
              {workspace.syncJobs.map((job) => (
                <div className="sync-row" key={job.id}>
                  <div>
                    <strong>{job.title}</strong>
                    <p>{job.detail}</p>
                  </div>
                  <div className="security-side">
                    <span className={syncClassMap[job.status]}>{job.status}</span>
                    <span className="security-value">{job.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}

export default App;
