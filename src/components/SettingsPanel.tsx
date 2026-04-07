import type {
  AccountSummary,
  LedgerSeverity,
  RuntimeEnvironment,
  SecurityMetric,
  SecurityStatus,
  SyncJob,
  SyncStatus,
  WorkspaceSnapshot
} from "../../shared/contracts.js";
import { SignatureEditor } from "./SignatureEditor.js";

type SettingsPanelProps = {
  environment: RuntimeEnvironment;
  platform: string;
  recentActivity: WorkspaceSnapshot["shellState"]["transparencyLedger"];
  recentSecurityMetrics: SecurityMetric[];
  recentSyncJobs: SyncJob[];
  selectedAccount?: AccountSummary;
  verifyingAccountId: string | null;
  onSignatureSaved: () => void;
  onVerifyAccount: (accountId: string) => void;
};

const securityClassMap: Record<SecurityStatus, string> = {
  active: "status-pill status-pill-active",
  monitoring: "status-pill status-pill-monitoring",
  idle: "status-pill status-pill-idle"
};

const accountClassMap = {
  online: "status-pill status-pill-active",
  syncing: "status-pill status-pill-monitoring",
  attention: "status-pill status-pill-critical"
} as const;

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

const formatPlatform = (platform: string) => {
  if (!platform) {
    return "Unknown";
  }

  return `${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
};

export function SettingsPanel({
  environment,
  platform,
  recentActivity,
  recentSecurityMetrics,
  recentSyncJobs,
  selectedAccount,
  verifyingAccountId,
  onSignatureSaved,
  onVerifyAccount
}: SettingsPanelProps) {
  return (
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
            onClick={() => onVerifyAccount(selectedAccount.id)}
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
                <span className={environmentClassMap[environment]}>{environment}</span>
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
                  <dd>{formatPlatform(platform)}</dd>
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

          <section className="settings-grid">
            <SignatureEditor accountId={selectedAccount.id} onSaved={onSignatureSaved} />
          </section>
        </>
      ) : (
        <div className="empty-panel">
          <h3>No account selected.</h3>
          <p>Select a mailbox from the left rail.</p>
        </div>
      )}
    </article>
  );
}
