export type SecurityStatus = "active" | "monitoring" | "idle";

export type AccountStatus = "online" | "syncing" | "attention";

export type MailTrust = "trusted" | "encrypted" | "review";

export type SyncStatus = "running" | "queued" | "complete";

export type LedgerSeverity = "info" | "notice" | "critical";

export type RuntimeEnvironment = "development" | "production";

export type MessageContentMode = "plain" | "html-blocked" | "remote-pending";

export type TransportSecurity = "ssl_tls" | "starttls" | "plain";

export type SmtpAuthMethod = "auto" | "plain" | "login" | "none";

export type ReleaseTarget = {
  os: "linux" | "windows" | "macos";
  formats: string[];
  status: "configured" | "pending";
  note: string;
};

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
  environment: RuntimeEnvironment;
  packaged: boolean;
  secureDesktopMode: boolean;
  releaseTargets: ReleaseTarget[];
  capabilities: string[];
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
  accountId?: string | null;
  name: string;
  count: number;
  kind: "inbox" | "priority" | "drafts" | "sent" | "archive" | "security" | "custom";
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
  contentMode: MessageContentMode;
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

export type CreateAccountInput = {
  name: string;
  address: string;
  provider: string;
  username: string;
  password: string;
  incomingServer: string;
  incomingPort: number;
  incomingSecurity: TransportSecurity;
  outgoingServer: string;
  outgoingPort: number;
  outgoingSecurity: TransportSecurity;
  outgoingAuthMethod: SmtpAuthMethod;
};

export type CreateDraftInput = {
  accountId: string;
  to: string;
  subject: string;
  body: string;
  replyToMessageId?: string;
};

export type FetchMessageBodyInput = {
  accountId: string;
  messageId: string;
};

export type ActionResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
      data?: T;
    };

export type DesktopApi = {
  getWorkspaceSnapshot: () => Promise<WorkspaceSnapshot>;
  createAccount: (input: CreateAccountInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  createDraft: (input: CreateDraftInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  verifyAccount: (accountId: string) => Promise<ActionResult<WorkspaceSnapshot>>;
  sendMessage: (input: CreateDraftInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  fetchMessageBody: (input: FetchMessageBodyInput) => Promise<ActionResult<WorkspaceSnapshot>>;
};
