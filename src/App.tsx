import { useEffect, useState } from "react";
import type {
  AccountStatus,
  ActionResult,
  CreateAccountInput,
  CreateDraftInput,
  LedgerSeverity,
  MailTrust,
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

const initialAccountForm: CreateAccountInput = {
  name: "",
  address: "",
  provider: "IMAP",
  username: "",
  password: "",
  incomingServer: "",
  incomingPort: 993,
  incomingSecurity: "ssl_tls",
  outgoingServer: "",
  outgoingPort: 465,
  outgoingSecurity: "ssl_tls",
  outgoingAuthMethod: "auto"
};

const emptyWorkspace: WorkspaceSnapshot = {
  shellState: {
    appName: "DejAzmach",
    version: "local",
    platform: "browser",
    environment: "development",
    packaged: false,
    secureDesktopMode: true,
    releaseTargets: [],
    capabilities: [],
    securityMetrics: [
      {
        label: "Desktop bridge",
        value: "Required",
        status: "monitoring",
        detail: "Account actions only work when the Electron preload bridge is active."
      },
      {
        label: "Credential storage",
        value: "Main process only",
        status: "monitoring",
        detail: "Secrets are kept outside the renderer and only handled by the desktop shell."
      }
    ],
    transparencyLedger: [
      {
        id: "local-1",
        title: "Workspace initialized",
        detail: "No mailbox content is rendered until a real desktop workspace is loaded.",
        occurredAt: "Local",
        severity: "notice"
      }
    ]
  },
  accounts: [],
  folders: [],
  messages: [],
  threads: [],
  syncJobs: []
};

const formatPlatform = (platform: string) => {
  if (!platform) {
    return "Unknown";
  }

  return `${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
};

const getAccountFolders = (workspace: WorkspaceSnapshot, accountId: string) =>
  workspace.folders.filter((folder) => folder.accountId === accountId);

const getFirstFolderId = (workspace: WorkspaceSnapshot, accountId: string) => {
  if (!accountId) {
    return "";
  }

  const folders = getAccountFolders(workspace, accountId);
  return folders.find((folder) => folder.kind === "inbox")?.id ?? folders[0]?.id ?? "";
};

const getFolderIdForAccount = (
  workspace: WorkspaceSnapshot,
  accountId: string,
  kind: "inbox" | "drafts" | "sent" | "archive" | "security"
) => {
  if (!accountId) {
    return "";
  }

  const folders = getAccountFolders(workspace, accountId);
  return folders.find((folder) => folder.kind === kind)?.id ?? getFirstFolderId(workspace, accountId);
};

const getFirstThreadId = (workspace: WorkspaceSnapshot, accountId: string, folderId: string) => {
  if (!accountId || !folderId) {
    return "";
  }

  return (
    workspace.messages.find((message) => message.accountId === accountId && message.folderId === folderId)?.threadId ??
    workspace.messages.find((message) => message.accountId === accountId)?.threadId ??
    ""
  );
};

const getInitials = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "M";

const unwrapResult = (result: ActionResult<WorkspaceSnapshot>) => {
  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.data;
};

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(emptyWorkspace);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [activeSurface, setActiveSurface] = useState<"message" | "compose" | "settings">("message");
  const [searchQuery, setSearchQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(Boolean(window.desktopApi));
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [loadingMessageBodyId, setLoadingMessageBodyId] = useState<string | null>(null);
  const [verifyingAccountId, setVerifyingAccountId] = useState<string | null>(null);
  const [showAccountSetup, setShowAccountSetup] = useState(false);
  const [accountForm, setAccountForm] = useState<CreateAccountInput>(initialAccountForm);
  const [draftForm, setDraftForm] = useState<CreateDraftInput>({
    accountId: "",
    to: "",
    subject: "",
    body: ""
  });

  const applyWorkspace = (nextWorkspace: WorkspaceSnapshot) => {
    const nextAccountId = nextWorkspace.accounts.some((account) => account.id === selectedAccountId)
      ? selectedAccountId
      : (nextWorkspace.accounts[0]?.id ?? "");
    const nextFolderId = nextWorkspace.folders.some((folder) => folder.id === selectedFolderId)
      ? selectedFolderId
      : getFirstFolderId(nextWorkspace, nextAccountId);
    const nextThreadId = nextWorkspace.threads.some((thread) => thread.id === selectedThreadId)
      ? selectedThreadId
      : getFirstThreadId(nextWorkspace, nextAccountId, nextFolderId);

    setWorkspace(nextWorkspace);
    setSelectedAccountId(nextAccountId);
    setSelectedFolderId(nextFolderId);
    setSelectedThreadId(nextThreadId);
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
      setLoadError("Desktop bridge unavailable. Launch the packaged Electron app instead of a browser preview.");
      setIsBooting(false);
      return;
    }

    void window.desktopApi
      .getWorkspaceSnapshot()
      .then((nextWorkspace) => {
        applyWorkspace(nextWorkspace);
      })
      .catch(() => {
        setLoadError("Desktop data could not be loaded.");
      })
      .finally(() => {
        setIsBooting(false);
      });
  }, []);

  const hasAccounts = workspace.accounts.length > 0;
  const selectedAccount =
    workspace.accounts.find((account) => account.id === selectedAccountId) ?? workspace.accounts[0];
  const visibleFolders = selectedAccount ? getAccountFolders(workspace, selectedAccount.id) : [];
  const selectedFolder = visibleFolders.find((folder) => folder.id === selectedFolderId) ?? visibleFolders[0];
  const accountMessages = selectedAccount
    ? workspace.messages.filter((message) => message.accountId === selectedAccount.id)
    : [];
  const search = searchQuery.trim().toLowerCase();
  const folderMessages = selectedAccount
    ? accountMessages.filter((message) => message.folderId === selectedFolder?.id)
    : [];
  const visibleMessages = !search
    ? folderMessages
    : folderMessages.filter((message) =>
        [message.sender, message.subject, message.preview, message.label].some((value) =>
          value.toLowerCase().includes(search)
        )
      );
  const selectedThread =
    workspace.threads.find((thread) => thread.id === selectedThreadId) ??
    workspace.threads.find((thread) => thread.id === visibleMessages[0]?.threadId);
  const recentActivity = workspace.shellState.transparencyLedger.slice(0, 4);
  const recentSecurityMetrics = workspace.shellState.securityMetrics.slice(0, 4);
  const recentSyncJobs = workspace.syncJobs.slice(0, 3);
  const readerMessage = visibleMessages.find((message) => message.threadId === selectedThread?.id);

  const chooseAccount = (accountId: string) => {
    const nextFolderId = getFirstFolderId(workspace, accountId);
    setSelectedAccountId(accountId);
    setSelectedFolderId(nextFolderId);
    setSelectedThreadId(getFirstThreadId(workspace, accountId, nextFolderId));
    setActiveSurface("message");
  };

  const chooseFolder = (folderId: string) => {
    if (!selectedAccount) {
      return;
    }

    setSelectedFolderId(folderId);
    setSelectedThreadId(getFirstThreadId(workspace, selectedAccount.id, folderId));
    setActiveSurface("message");
  };

  const openComposer = (accountId = selectedAccount?.id ?? workspace.accounts[0]?.id ?? "") => {
    setDraftForm((currentDraft) => ({
      ...currentDraft,
      accountId
    }));
    setActiveSurface("compose");
  };

  const openMessage = async (messageId: string, threadId: string) => {
    setSelectedThreadId(threadId);
    setActiveSurface("message");
    setActionError(null);

    const thread = workspace.threads.find((candidate) => candidate.id === threadId);
    const needsRemoteFetch = thread?.messages.some(
      (message) => message.id === messageId && message.contentMode === "remote-pending"
    );

    if (!needsRemoteFetch || !window.desktopApi) {
      return;
    }

    setLoadingMessageBodyId(messageId);

    try {
      const result = await window.desktopApi.fetchMessageBody({
        accountId: selectedAccount?.id ?? "",
        messageId
      });
      if (result.data) {
        applyWorkspace(result.data);
      }
      unwrapResult(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Message body fetch failed.");
    } finally {
      setLoadingMessageBodyId(null);
    }
  };

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
      const nextWorkspace = unwrapResult(await window.desktopApi.createAccount(accountForm));
      const createdAccount = nextWorkspace.accounts[nextWorkspace.accounts.length - 1];
      applyWorkspace(nextWorkspace);

      if (createdAccount) {
        const nextFolderId = getFirstFolderId(nextWorkspace, createdAccount.id);
        setSelectedAccountId(createdAccount.id);
        setSelectedFolderId(nextFolderId);
        setSelectedThreadId(getFirstThreadId(nextWorkspace, createdAccount.id, nextFolderId));
        setDraftForm((currentDraft) => ({ ...currentDraft, accountId: createdAccount.id }));
      }

      setAccountForm(initialAccountForm);
      setShowAccountSetup(false);
      setActiveSurface("message");
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
      const nextWorkspace = unwrapResult(await window.desktopApi.createDraft(draftForm));
      const nextFolderId = getFolderIdForAccount(nextWorkspace, draftForm.accountId, "drafts");
      applyWorkspace(nextWorkspace);
      setSelectedAccountId(draftForm.accountId);
      setSelectedFolderId(nextFolderId);
      setSelectedThreadId(getFirstThreadId(nextWorkspace, draftForm.accountId, nextFolderId));
      setDraftForm((currentDraft) => ({
        ...currentDraft,
        to: "",
        subject: "",
        body: ""
      }));
      setActiveSurface("message");
      setActionNotice("Draft stored locally.");
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
      const result = await window.desktopApi.verifyAccount(accountId);
      if (result.data) {
        applyWorkspace(result.data);
      }
      const nextWorkspace = unwrapResult(result);
      const nextFolderId = getFolderIdForAccount(nextWorkspace, accountId, "inbox");
      setSelectedAccountId(accountId);
      setSelectedFolderId(nextFolderId);
      setSelectedThreadId(getFirstThreadId(nextWorkspace, accountId, nextFolderId));
      setActiveSurface("message");
      setActionNotice("Account verification completed and server folders were refreshed.");
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
      const result = await window.desktopApi.sendMessage(draftForm);
      if (result.data) {
        applyWorkspace(result.data);
      }
      const nextWorkspace = unwrapResult(result);
      const nextFolderId = getFolderIdForAccount(nextWorkspace, draftForm.accountId, "sent");
      setSelectedAccountId(draftForm.accountId);
      setSelectedFolderId(nextFolderId);
      setSelectedThreadId(getFirstThreadId(nextWorkspace, draftForm.accountId, nextFolderId));
      setDraftForm((currentDraft) => ({
        ...currentDraft,
        to: "",
        subject: "",
        body: ""
      }));
      setActiveSurface("message");
      setActionNotice("Message submitted through SMTP.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Message delivery failed.");
    } finally {
      setIsSendingMessage(false);
    }
  };

  const renderAccountForm = (title: string, subtitle: string, compact = false) => (
    <article className={compact ? "modal-card onboarding-card" : "onboarding-card"}>
      <header className="onboarding-header">
        <span className="eyebrow">{subtitle}</span>
        <h2>{title}</h2>
        <p>Enter the mailbox details exactly as provided by your mail host. Folders are discovered from IMAP after verification.</p>
      </header>

      <form className="account-form" onSubmit={handleAccountSubmit}>
        <section className="form-section">
          <div className="section-heading-row">
            <strong>Identity</strong>
            <span>How this account appears in DejAzmach.</span>
          </div>

          <div className="form-grid form-grid-two">
            <label className="field">
              <span>Display name</span>
              <input
                onChange={(event) => setAccountForm((current) => ({ ...current, name: event.target.value }))}
                required
                value={accountForm.name}
              />
            </label>

            <label className="field">
              <span>Email address</span>
              <input
                onChange={(event) => setAccountForm((current) => ({ ...current, address: event.target.value }))}
                required
                type="email"
                value={accountForm.address}
              />
            </label>

            <label className="field">
              <span>Provider label</span>
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

            <label className="field field-full">
              <span>Password or app password</span>
              <input
                onChange={(event) => setAccountForm((current) => ({ ...current, password: event.target.value }))}
                required
                type="password"
                value={accountForm.password}
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
              <input
                onChange={(event) => setAccountForm((current) => ({ ...current, incomingServer: event.target.value }))}
                required
                value={accountForm.incomingServer}
              />
            </label>

            <label className="field">
              <span>Port</span>
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
              <span>Security</span>
              <select
                onChange={(event) =>
                  setAccountForm((current) => ({
                    ...current,
                    incomingSecurity: event.target.value as CreateAccountInput["incomingSecurity"]
                  }))
                }
                value={accountForm.incomingSecurity}
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
              <input
                onChange={(event) => setAccountForm((current) => ({ ...current, outgoingServer: event.target.value }))}
                required
                value={accountForm.outgoingServer}
              />
            </label>

            <label className="field">
              <span>Port</span>
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

            <label className="field">
              <span>Security</span>
              <select
                onChange={(event) =>
                  setAccountForm((current) => ({
                    ...current,
                    outgoingSecurity: event.target.value as CreateAccountInput["outgoingSecurity"]
                  }))
                }
                value={accountForm.outgoingSecurity}
              >
                <option value="ssl_tls">SSL/TLS</option>
                <option value="starttls">STARTTLS</option>
                <option value="plain">Plain</option>
              </select>
            </label>

            <label className="field">
              <span>SMTP auth</span>
              <select
                onChange={(event) =>
                  setAccountForm((current) => ({
                    ...current,
                    outgoingAuthMethod: event.target.value as CreateAccountInput["outgoingAuthMethod"]
                  }))
                }
                value={accountForm.outgoingAuthMethod}
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
            {isSavingAccount ? "Saving account..." : "Add account"}
          </button>
          {compact ? (
            <button className="secondary-button" onClick={() => setShowAccountSetup(false)} type="button">
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </article>
  );

  return (
    <main className="app-shell">
      {isBooting ? (
        <div className="boot-overlay" aria-live="polite">
          <div className="boot-card">
            <span className="eyebrow">DejAzmach desktop shell</span>
            <h2>Preparing secure workspace</h2>
            <p>Loading the restricted Electron shell and local workspace services.</p>
          </div>
        </div>
      ) : null}

      {hasAccounts && showAccountSetup ? (
        <div className="modal-overlay">
          {renderAccountForm("Add another mailbox", "Account setup", true)}
        </div>
      ) : null}

      {!hasAccounts ? (
        <section className="welcome-shell">
          <div className="welcome-backdrop welcome-backdrop-left" aria-hidden="true" />
          <div className="welcome-backdrop welcome-backdrop-right" aria-hidden="true" />

          <article className="welcome-copy">
            <span className="eyebrow">DejAzmach</span>
            <h1>Connect one mailbox, then the full desktop workspace appears.</h1>
            <p>
              No demo inbox. No fake folders. DejAzmach stays empty until a real account is configured
              and verified against the server.
            </p>

            <div className="welcome-points">
              <div className="welcome-point">
                <strong>Server-driven folders</strong>
                <p>IMAP folders are fetched from the host, so custom mailbox structures show up correctly.</p>
              </div>
              <div className="welcome-point">
                <strong>Three-pane workflow</strong>
                <p>After setup, the interface switches to account rail, message list, and reading pane.</p>
              </div>
              <div className="welcome-point">
                <strong>Main-process secrets</strong>
                <p>Credentials stay out of the renderer and message HTML remains blocked by default.</p>
              </div>
            </div>

            {loadError ? <p className="inline-notice">{loadError}</p> : null}
            {actionError ? <p className="inline-notice inline-notice-critical">{actionError}</p> : null}
            {actionNotice ? <p className="inline-notice inline-notice-success">{actionNotice}</p> : null}
          </article>

          <div className="welcome-form">{renderAccountForm("Configure your first account", "Welcome")}</div>
        </section>
      ) : (
        <>
          {loadError || actionError || actionNotice ? (
            <section className="notice-strip">
              {loadError ? <p className="inline-notice">{loadError}</p> : null}
              {actionError ? <p className="inline-notice inline-notice-critical">{actionError}</p> : null}
              {actionNotice ? <p className="inline-notice inline-notice-success">{actionNotice}</p> : null}
            </section>
          ) : null}

          <section className="workspace-frame">
            <aside className="sidebar-pane">
              <div className="sidebar-brand">
                <div className="brand-orb">D</div>
                <div>
                  <span className="eyebrow eyebrow-inverse">Secure desktop mail</span>
                  <h1>{workspace.shellState.appName}</h1>
                </div>
              </div>

              <button className="compose-button" onClick={() => openComposer()} type="button">
                New message
              </button>

              <section className="sidebar-section">
                <div className="sidebar-section-header">
                  <span className="eyebrow eyebrow-inverse">Accounts</span>
                </div>

                <div className="account-stack">
                  {workspace.accounts.map((account) => (
                    <button
                      className={account.id === selectedAccount?.id ? "account-tile account-tile-active" : "account-tile"}
                      key={account.id}
                      onClick={() => chooseAccount(account.id)}
                      type="button"
                    >
                      <span className="account-avatar">{getInitials(account.name)}</span>
                      <span className="account-copy">
                        <strong>{account.name}</strong>
                        <span>{account.address}</span>
                      </span>
                      <span className="account-count">{account.unreadCount}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="sidebar-section sidebar-section-grow">
                <div className="sidebar-section-header">
                  <span className="eyebrow eyebrow-inverse">Folders</span>
                </div>

                {visibleFolders.length > 0 ? (
                  <div className="folder-stack">
                    {visibleFolders.map((folder) => (
                      <button
                        className={folder.id === selectedFolder?.id ? "folder-tile folder-tile-active" : "folder-tile"}
                        key={folder.id}
                        onClick={() => chooseFolder(folder.id)}
                        type="button"
                      >
                        <span>{folder.name}</span>
                        <span className="folder-count">{folder.count}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="sidebar-empty">
                    Verify this account to fetch the real folder tree from the IMAP server.
                  </div>
                )}
              </section>

              <section className="sidebar-footer">
                <button className="sidebar-action" onClick={() => setActiveSurface("settings")} type="button">
                  Account settings
                </button>
                <button className="sidebar-action sidebar-action-muted" onClick={() => setShowAccountSetup(true)} type="button">
                  Add account
                </button>
              </section>
            </aside>

            <section className="message-pane">
              <header className="pane-header">
                <div>
                  <span className="eyebrow">Mailbox</span>
                  <h2>{selectedFolder?.name ?? "Folders"}</h2>
                </div>
                <span className={selectedAccount ? accountClassMap[selectedAccount.status] : "status-pill status-pill-idle"}>
                  {selectedAccount?.status ?? "idle"}
                </span>
              </header>

              <label className="search-shell">
                <span className="search-label">Search</span>
                <input
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search messages..."
                  value={searchQuery}
                />
              </label>

              <div className="message-pane-meta">
                <span>{visibleMessages.length} messages</span>
                {selectedAccount ? <span>{selectedAccount.unreadCount} unread</span> : null}
              </div>

              <div className="message-list">
                {visibleMessages.length > 0 ? (
                  visibleMessages.map((message) => (
                    <button
                      className={message.threadId === selectedThread?.id ? "message-row message-row-active" : "message-row"}
                      key={message.id}
                      onClick={() => {
                        void openMessage(message.id, message.threadId);
                      }}
                      type="button"
                    >
                      <span className="message-avatar">{getInitials(message.sender)}</span>
                      <span className="message-copy">
                        <span className="message-line">
                          <strong>{message.sender}</strong>
                          <span>{message.time}</span>
                        </span>
                        <span className="message-subject">
                          {message.subject}
                          {message.unread ? <span className="unread-dot" aria-hidden="true" /> : null}
                        </span>
                        <span className="message-preview">{message.preview}</span>
                        <span className="message-meta">
                          <span className="tag">{message.label}</span>
                          <span className={trustClassMap[message.trust]}>{message.trust}</span>
                        </span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="empty-panel">
                    <h3>No messages found.</h3>
                    <p>
                      {selectedFolder
                        ? "This folder is empty, or the current search does not match any message."
                        : "Verify the account to fetch folders from the server."}
                    </p>
                  </div>
                )}
              </div>
            </section>

            <section className="reader-pane">
              {activeSurface === "compose" ? (
                <article className="reader-card">
                  <header className="pane-header">
                    <div>
                      <span className="eyebrow">Compose</span>
                      <h2>New message</h2>
                    </div>
                    <button className="secondary-button" onClick={() => setActiveSurface("message")} type="button">
                      Close
                    </button>
                  </header>

                  <form className="compose-form" onSubmit={handleDraftSubmit}>
                    <div className="compose-grid">
                      <label className="field field-full">
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

                      <label className="field field-full">
                        <span>To</span>
                        <input
                          onChange={(event) => setDraftForm((current) => ({ ...current, to: event.target.value }))}
                          placeholder="recipient@example.com"
                          value={draftForm.to}
                        />
                      </label>

                      <label className="field field-full">
                        <span>Subject</span>
                        <input
                          onChange={(event) => setDraftForm((current) => ({ ...current, subject: event.target.value }))}
                          value={draftForm.subject}
                        />
                      </label>

                      <label className="field field-full">
                        <span>Body</span>
                        <textarea
                          onChange={(event) => setDraftForm((current) => ({ ...current, body: event.target.value }))}
                          rows={16}
                          value={draftForm.body}
                        />
                      </label>
                    </div>

                    <div className="compose-actions">
                      <button className="secondary-button" disabled={isSavingDraft} type="submit">
                        {isSavingDraft ? "Saving..." : "Save draft"}
                      </button>
                      <button
                        className="primary-button"
                        disabled={isSendingMessage || !draftForm.accountId}
                        onClick={() => void handleSendMessage()}
                        type="button"
                      >
                        {isSendingMessage ? "Sending..." : "Send"}
                      </button>
                    </div>
                  </form>
                </article>
              ) : activeSurface === "settings" ? (
                <article className="reader-card">
                  <header className="pane-header">
                    <div>
                      <span className="eyebrow">Settings</span>
                      <h2>{selectedAccount?.name ?? "Account settings"}</h2>
                    </div>
                    {selectedAccount ? (
                      <button
                        className="primary-button"
                        disabled={verifyingAccountId === selectedAccount.id}
                        onClick={() => void handleVerifyAccount(selectedAccount.id)}
                        type="button"
                      >
                        {verifyingAccountId === selectedAccount.id ? "Verifying..." : "Verify & sync"}
                      </button>
                    ) : null}
                  </header>

                  {selectedAccount ? (
                    <>
                      <section className="settings-grid">
                        <div className="settings-card">
                          <span className="eyebrow">Account</span>
                          <h3>{selectedAccount.address}</h3>
                          <p>{selectedAccount.provider}</p>
                          <div className="settings-badges">
                            <span className={accountClassMap[selectedAccount.status]}>{selectedAccount.status}</span>
                            <span className={environmentClassMap[workspace.shellState.environment]}>
                              {workspace.shellState.environment}
                            </span>
                          </div>
                          <dl className="settings-list">
                            <div>
                              <dt>Storage</dt>
                              <dd>{selectedAccount.storage}</dd>
                            </div>
                            <div>
                              <dt>Last sync</dt>
                              <dd>{selectedAccount.lastSync}</dd>
                            </div>
                            <div>
                              <dt>Platform</dt>
                              <dd>{formatPlatform(workspace.shellState.platform)}</dd>
                            </div>
                          </dl>
                        </div>

                        <div className="settings-card">
                          <span className="eyebrow">Security</span>
                          <h3>Desktop protection</h3>
                          <div className="metric-list">
                            {recentSecurityMetrics.map((metric) => (
                              <div className="metric-row" key={metric.label}>
                                <div>
                                  <strong>{metric.label}</strong>
                                  <p>{metric.detail}</p>
                                </div>
                                <div className="metric-meta">
                                  <span className={securityClassMap[metric.status]}>{metric.status}</span>
                                  <span>{metric.value}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </section>

                      <section className="activity-grid">
                        <div className="settings-card">
                          <span className="eyebrow">Activity</span>
                          <h3>Recent events</h3>
                          <div className="metric-list">
                            {recentActivity.length > 0 ? (
                              recentActivity.map((entry) => (
                                <div className="metric-row" key={entry.id}>
                                  <div>
                                    <strong>{entry.title}</strong>
                                    <p>{entry.detail}</p>
                                  </div>
                                  <div className="metric-meta">
                                    <span className={ledgerClassMap[entry.severity]}>{entry.severity}</span>
                                    <span>{entry.occurredAt}</span>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="empty-note">No trust-relevant events have been recorded yet.</div>
                            )}
                          </div>
                        </div>

                        <div className="settings-card">
                          <span className="eyebrow">Sync</span>
                          <h3>Recent jobs</h3>
                          <div className="metric-list">
                            {recentSyncJobs.length > 0 ? (
                              recentSyncJobs.map((job) => (
                                <div className="metric-row" key={job.id}>
                                  <div>
                                    <strong>{job.title}</strong>
                                    <p>{job.detail}</p>
                                  </div>
                                  <div className="metric-meta">
                                    <span className={syncClassMap[job.status]}>{job.status}</span>
                                    <span>{job.time}</span>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="empty-note">No sync jobs have run yet.</div>
                            )}
                          </div>
                        </div>
                      </section>
                    </>
                  ) : (
                    <div className="empty-panel">
                      <h3>No account selected.</h3>
                      <p>Select a mailbox from the left rail.</p>
                    </div>
                  )}
                </article>
              ) : selectedThread ? (
                <article className="reader-card">
                  <header className="reader-header">
                    <div className="reader-title">
                      <span className="eyebrow">Conversation</span>
                      <h2>{selectedThread.subject}</h2>
                      <p>{selectedThread.participants.join(", ")}</p>
                    </div>

                    <div className="reader-actions">
                      {readerMessage ? <span className={trustClassMap[readerMessage.trust]}>{readerMessage.trust}</span> : null}
                      <button className="secondary-button" onClick={() => openComposer(selectedAccount?.id)} type="button">
                        Reply
                      </button>
                    </div>
                  </header>

                  <div className="thread-stream">
                    {selectedThread.messages.map((message) => (
                      <article className="thread-message" key={message.id}>
                        <div className="thread-topline">
                          <div className="thread-person">
                            <span className="message-avatar">{getInitials(message.sender)}</span>
                            <div>
                              <strong>{message.sender}</strong>
                              <p>{message.address}</p>
                            </div>
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

                        {message.contentMode === "remote-pending" ? (
                          <div className="thread-warning">
                            {loadingMessageBodyId === message.id
                              ? "Fetching the full RFC822 body from IMAP..."
                              : "This message was synced as headers only. Open it from the list to fetch the full RFC822 body."}
                          </div>
                        ) : null}

                        <pre className="thread-body">{message.body}</pre>
                      </article>
                    ))}
                  </div>
                </article>
              ) : (
                <article className="reader-card">
                  <div className="empty-panel empty-panel-reader">
                    <h3>No conversation selected.</h3>
                    <p>Select a message from the center column or start a new draft.</p>
                  </div>
                </article>
              )}
            </section>
          </section>
        </>
      )}
    </main>
  );
}

export default App;
