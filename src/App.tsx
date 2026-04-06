import { useEffect, useState } from "react";

type SecurityStatus = "active" | "monitoring" | "idle";

type ShellState = {
  appName: string;
  version: string;
  platform: string;
  secureDesktopMode: boolean;
  securityMetrics: Array<{
    label: string;
    value: string;
    status: SecurityStatus;
    detail: string;
  }>;
  transparencyLedger: string[];
};

type MailSummary = {
  sender: string;
  subject: string;
  preview: string;
  label: string;
  time: string;
  unread?: boolean;
};

const inbox: MailSummary[] = [
  {
    sender: "Infrastructure",
    subject: "Root key rotation completed",
    preview: "Your admin signing key was rotated and all device sessions remain intact.",
    label: "Security",
    time: "08:10",
    unread: true
  },
  {
    sender: "Design Council",
    subject: "DejAzmach launch visuals",
    preview: "The final desktop surfaces are approved with the privacy ribbon and evidence drawer.",
    label: "Brand",
    time: "07:42"
  },
  {
    sender: "Ops Ledger",
    subject: "Attachment sandbox report",
    preview: "Two files were opened outside the app, both after explicit confirmation.",
    label: "Audit",
    time: "06:30"
  }
];

const currentThread = {
  sender: "Infrastructure",
  title: "Root key rotation completed",
  sentAt: "Today, 08:10",
  body: `Morning team,

The key rotation finished cleanly across desktop profiles. DejAzmach kept remote content disabled during sync, attachment policy stayed locked, and no background trackers were contacted.

Next step:
- wire IMAP and SMTP through a hardened main-process mail service
- store account credentials in the operating system keychain
- keep the renderer focused on presentation only

This UI build should keep making trust legible instead of hiding it in settings.`
};

const securityClassMap: Record<SecurityStatus, string> = {
  active: "status-pill status-pill-active",
  monitoring: "status-pill status-pill-monitoring",
  idle: "status-pill status-pill-idle"
};

const browserPreviewState: ShellState = {
  appName: "DejAzmach",
  version: "preview",
  platform: "browser",
  secureDesktopMode: true,
  securityMetrics: [
    {
      label: "Remote content",
      value: "Blocked by default",
      status: "active",
      detail: "Preview mode mirrors the desktop policy so the UI stays honest about the intended trust model."
    },
    {
      label: "Vault encryption",
      value: "OS-backed design",
      status: "monitoring",
      detail: "Credential storage belongs in the operating system keychain once account wiring is implemented."
    }
  ],
  transparencyLedger: [
    "Browser preview mode is using local mock shell state.",
    "Electron IPC is required for the full desktop trust surface."
  ]
};

function App() {
  const [shellState, setShellState] = useState<ShellState>(browserPreviewState);

  useEffect(() => {
    if (!window.desktopApi) {
      return;
    }

    void window.desktopApi.getShellState().then(setShellState);
  }, []);

  return (
    <main className="shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">DejAzmach secure desktop mail</span>
          <h1>Mail that shows its work.</h1>
          <p>
            A desktop client foundation with strong Electron boundaries, transparent security posture,
            and a visual language that feels deliberate instead of generic.
          </p>
        </div>

        <div className="hero-grid">
          <article className="glass-card hero-stat">
            <span className="card-label">Trust model</span>
            <strong>{shellState?.secureDesktopMode ? "Secure desktop mode" : "Loading"}</strong>
            <p>Renderer stays sandboxed. Only a narrow preload bridge is exposed to UI code.</p>
          </article>

          <article className="glass-card hero-stat accent-card">
            <span className="card-label">Transparency ledger</span>
            <strong>{shellState?.transparencyLedger.length ?? 0} visible guarantees</strong>
            <p>Every privacy-sensitive behavior should become inspectable, not implied.</p>
          </article>
        </div>
      </section>

      <section className="workspace">
        <aside className="nav-rail glass-card">
          <div>
            <span className="card-label">Workspace</span>
            <h2>Command deck</h2>
          </div>

          <nav className="nav-list" aria-label="Primary">
            <button className="nav-item nav-item-active">Priority inbox</button>
            <button className="nav-item">Shielded drafts</button>
            <button className="nav-item">Audit trail</button>
            <button className="nav-item">Account vault</button>
          </nav>

          <div className="mini-panel">
            <span className="card-label">Platform</span>
            <strong>{shellState?.platform ?? "loading"}</strong>
            <p>App version {shellState?.version ?? "..."}</p>
          </div>
        </aside>

        <section className="mail-column glass-card">
          <header className="section-header">
            <div>
              <span className="card-label">Inbox</span>
              <h2>Visible operations</h2>
            </div>
            <button className="ghost-button">Compose</button>
          </header>

          <div className="mail-list">
            {inbox.map((message) => (
              <article className="mail-item" key={`${message.sender}-${message.subject}`}>
                <div className="mail-topline">
                  <strong>{message.sender}</strong>
                  <span>{message.time}</span>
                </div>
                <h3>
                  {message.subject}
                  {message.unread ? <span className="unread-dot" aria-hidden="true" /> : null}
                </h3>
                <p>{message.preview}</p>
                <span className="tag">{message.label}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="reader-column">
          <article className="glass-card reader-card">
            <header className="section-header">
              <div>
                <span className="card-label">Thread</span>
                <h2>{currentThread.title}</h2>
              </div>
              <button className="ghost-button">Reply securely</button>
            </header>

            <div className="thread-meta">
              <strong>{currentThread.sender}</strong>
              <span>{currentThread.sentAt}</span>
            </div>

            <pre className="thread-body">{currentThread.body}</pre>
          </article>

          <article className="glass-card security-card">
            <header className="section-header">
              <div>
                <span className="card-label">Security posture</span>
                <h2>Trust surface</h2>
              </div>
            </header>

            <div className="metric-list">
              {shellState?.securityMetrics.map((metric) => (
                <div className="metric-row" key={metric.label}>
                  <div>
                    <strong>{metric.label}</strong>
                    <p>{metric.detail}</p>
                  </div>
                  <div className="metric-side">
                    <span className={securityClassMap[metric.status]}>{metric.status}</span>
                    <span className="metric-value">{metric.value}</span>
                  </div>
                </div>
              )) ?? <p className="loading-copy">Loading security status…</p>}
            </div>
          </article>

          <article className="glass-card ledger-card">
            <header className="section-header">
              <div>
                <span className="card-label">Transparency</span>
                <h2>Session ledger</h2>
              </div>
            </header>

            <ul className="ledger-list">
              {shellState?.transparencyLedger.map((entry) => <li key={entry}>{entry}</li>) ?? null}
            </ul>
          </article>
        </section>
      </section>
    </main>
  );
}

export default App;
