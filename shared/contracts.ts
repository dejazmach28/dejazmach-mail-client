export type SecurityStatus = "active" | "monitoring" | "idle";

export type AccountStatus = "online" | "syncing" | "attention";

export type MailTrust = "trusted" | "encrypted" | "review";

export type SyncStatus = "running" | "queued" | "complete";

export type LedgerSeverity = "info" | "notice" | "critical";

export type SecurityMetric = {
  label: string;
  value: string;
  status: SecurityStatus;
  detail: string;
};

export type LedgerEntry = {
  id: string;
  title: string;
  detail: string;
  occurredAt: string;
  severity: LedgerSeverity;
};

export type ShellState = {
  appName: string;
  version: string;
  platform: string;
  secureDesktopMode: boolean;
  securityMetrics: SecurityMetric[];
  transparencyLedger: LedgerEntry[];
};

export type AccountSummary = {
  id: string;
  name: string;
  address: string;
  provider: string;
  status: AccountStatus;
  lastSync: string;
  unreadCount: number;
  storage: string;
};

export type FolderSummary = {
  id: string;
  name: string;
  count: number;
  kind: "inbox" | "priority" | "drafts" | "sent" | "archive" | "security";
};

export type MailSummary = {
  id: string;
  threadId: string;
  accountId: string;
  folderId: string;
  sender: string;
  subject: string;
  preview: string;
  label: string;
  time: string;
  unread?: boolean;
  trust: MailTrust;
};

export type ThreadMessage = {
  id: string;
  sender: string;
  address: string;
  sentAt: string;
  body: string;
  verified: boolean;
};

export type ThreadDetail = {
  id: string;
  subject: string;
  classification: string;
  participants: string[];
  messages: ThreadMessage[];
};

export type SyncJob = {
  id: string;
  title: string;
  detail: string;
  status: SyncStatus;
  time: string;
};

export type WorkspaceSnapshot = {
  shellState: ShellState;
  accounts: AccountSummary[];
  folders: FolderSummary[];
  messages: MailSummary[];
  threads: ThreadDetail[];
  syncJobs: SyncJob[];
};

export type DesktopApi = {
  getWorkspaceSnapshot: () => Promise<WorkspaceSnapshot>;
};
