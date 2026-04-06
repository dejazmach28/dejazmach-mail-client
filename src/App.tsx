import { useEffect, useState } from "react";
import type {
  AccountStatus,
  LedgerSeverity,
  MailTrust,
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

const browserPreviewWorkspace: WorkspaceSnapshot = {
  shellState: {
    appName: "DejAzmach",
    version: "preview",
    platform: "browser",
    secureDesktopMode: true,
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
    { id: "preview-folder", name: "Priority inbox", count: 1, kind: "priority" }
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
          body: "Electron preload data replaces this preview when the desktop app is running."
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

  useEffect(() => {
    if (!window.desktopApi) {
      return;
    }

    void window.desktopApi
      .getWorkspaceSnapshot()
      .then((nextWorkspace) => {
        setWorkspace(nextWorkspace);
        setSelectedFolderId(nextWorkspace.folders[0]?.id ?? "");
        setSelectedThreadId(nextWorkspace.messages[0]?.threadId ?? nextWorkspace.threads[0]?.id ?? "");
      })
      .catch(() => {
        setLoadError("Desktop data could not be loaded. Showing local preview state instead.");
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

  return (
    <main className="app-shell">
      <section className="top-banner">
        <article className="glass-card hero-card">
          <div className="hero-copy">
            <span className="eyebrow">DejAzmach secure desktop mail</span>
            <h1>Mail that exposes its trust surface.</h1>
            <p>
              A desktop-first foundation for a serious mail client: strong Electron boundaries,
              visible account and sync state, and a transparency ledger that explains what the app is
              doing instead of asking the user to assume.
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
              <span className="card-label">Live sync jobs</span>
              <strong>{runningSyncJobs}</strong>
            </div>
          </div>

          {loadError ? <p className="inline-notice">{loadError}</p> : null}
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
        </section>
      </section>
    </main>
  );
}

export default App;
