export type SecurityStatus = "active" | "monitoring" | "idle";

export type AccountStatus = "online" | "syncing" | "attention";

export type MailTrust = "trusted" | "encrypted" | "review";

export type SyncStatus = "running" | "queued" | "complete";

export type LedgerSeverity = "info" | "notice" | "critical";

export type RuntimeEnvironment = "development" | "production";

export type MessageContentMode = "plain" | "remote-pending";

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
  needsReauth: boolean;
  incomingServer: string;
  incomingPort: number;
  incomingSecurity: TransportSecurity;
  outgoingServer: string;
  outgoingPort: number;
  outgoingSecurity: TransportSecurity;
};

export type FolderSummary = {
  id: string;
  accountId?: string | null;
  name: string;
  count: number;
  kind: "inbox" | "priority" | "drafts" | "sent" | "archive" | "security" | "trash" | "custom";
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
  sentAt: string;
  unread?: boolean;
  flagged?: boolean;
  trust: MailTrust;
};

export type Attachment = {
  filename: string;
  mimeType: string;
  size: number;
  data: string;
};

export type ThreadMessage = {
  id: string;
  sender: string;
  address: string;
  to: string;
  cc: string;
  sentAt: string;
  body: string;
  html: string | null;
  attachments: Attachment[];
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
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  htmlBody?: string;
  attachments?: Attachment[];
  replyToMessageId?: string;
};

export type SendMessageInput = Omit<CreateDraftInput, "bcc"> & {
  bcc?: string[];
};

export type FetchMessageBodyInput = {
  accountId: string;
  messageId: string;
};

export type FetchMessageBodyResult = {
  body: string;
  html: string | null;
  attachments: Attachment[];
  to?: string;
  cc?: string;
};

export type SyncFolderInput = {
  accountId: string;
  folderName: string;
};

export type MessageMutationInput = {
  accountId: string;
  messageId: string;
};

export type MoveMessageInput = {
  accountId: string;
  messageId: string;
  targetFolderName: string;
};

export type ToggleFlagInput = {
  accountId: string;
  messageId: string;
  flagged: boolean;
};

export type SaveAttachmentInput = {
  filename: string;
  data: string;
  mimeType: string;
};

export type SaveAttachmentResult = {
  saved: boolean;
  path: string | null;
};

export type SignatureInput = {
  accountId: string;
  body: string;
};

export type ReauthAccountInput = {
  accountId: string;
  password: string;
};

export type UpdateAccountDisplayNameInput = {
  accountId: string;
  name: string;
};

export type UpdateAccountImapInput = {
  accountId: string;
  incomingServer: string;
  incomingPort: number;
  incomingSecurity: TransportSecurity;
};

export type UpdateAccountSmtpInput = {
  accountId: string;
  outgoingServer: string;
  outgoingPort: number;
  outgoingSecurity: TransportSecurity;
};

export type NotificationPreferences = {
  desktopNotifications: boolean;
  soundAlert: boolean;
  badgeCount: boolean;
  syncIntervalMinutes: 1 | 5 | 15 | 30 | 60;
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
  sendMessage: (input: SendMessageInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  fetchMessageBody: (input: FetchMessageBodyInput) => Promise<ActionResult<FetchMessageBodyResult>>;
  syncFolder: (input: SyncFolderInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  deleteMessage: (input: MessageMutationInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  markRead: (input: MessageMutationInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  markUnread: (input: MessageMutationInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  toggleFlag: (input: ToggleFlagInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  markSpam: (input: MessageMutationInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  moveMessage: (input: MoveMessageInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  archiveMessage: (input: MessageMutationInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  getSignature: (accountId: string) => Promise<ActionResult<{ body: string }>>;
  setSignature: (input: SignatureInput) => Promise<ActionResult<{ body: string }>>;
  reauthAccount: (input: ReauthAccountInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  updateAccountDisplayName: (input: UpdateAccountDisplayNameInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  updateAccountImap: (input: UpdateAccountImapInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  updateAccountSmtp: (input: UpdateAccountSmtpInput) => Promise<ActionResult<WorkspaceSnapshot>>;
  deleteAccount: (accountId: string) => Promise<ActionResult<WorkspaceSnapshot>>;
  getPreferences: () => Promise<ActionResult<NotificationPreferences>>;
  setPreferences: (input: NotificationPreferences) => Promise<ActionResult<NotificationPreferences>>;
  saveAttachment: (input: SaveAttachmentInput) => Promise<SaveAttachmentResult>;
  onWorkspaceUpdate: (callback: (snapshot: WorkspaceSnapshot) => void) => () => void;
};
