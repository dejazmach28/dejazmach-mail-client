import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Attachment,
  CreateAccountInput,
  CreateDraftInput,
  FetchMessageBodyInput,
  FetchMessageBodyResult,
  MessageMutationInput,
  MessageContentMode,
  NotificationPreferences,
  RuntimeEnvironment,
  SyncFolderInput,
  SmtpAuthMethod,
  ToggleFlagInput,
  TransportSecurity,
  SendMessageInput,
  UpdateAccountDisplayNameInput,
  UpdateAccountImapInput,
  UpdateAccountSmtpInput,
  WorkspaceSnapshot
} from "../shared/contracts.js";
import type { InboxHeader } from "./providerClient.js";
import {
  deleteImapMessage,
  describeTransportError,
  fetchImapFolderHeaders,
  fetchImapMessageBody,
  markImapMessageRead,
  markImapMessageUnread,
  moveImapMessage,
  sendPlainTextMessage,
  toggleImapMessageFlag,
  verifyAccountConnection
} from "./providerClient.js";

type Cipher = {
  isAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string | null;
};

type WorkspaceContext = {
  version: string;
  platform: string;
  environment: RuntimeEnvironment;
  packaged: boolean;
};

type MailServiceInput = {
  userDataPath: string;
  cipher: Cipher;
};

type MessageRow = {
  id: string;
  thread_id: string;
  account_id: string;
  folder_id: string;
  sender: string;
  address: string;
  subject: string;
  preview: string;
  label: string;
  time: string;
  unread: number;
  trust: "trusted" | "encrypted" | "review";
  sent_at: string;
  body: string;
  html_body?: string | null;
  attachments_json?: string | null;
  verified: number;
  flagged?: number;
  to_text?: string | null;
  cc_text?: string | null;
  content_mode: MessageContentMode;
  remote_message_ref?: string | null;
  remote_uid?: number | null;
  remote_sequence?: number | null;
  remote_folder_name?: string | null;
  created_at: string;
};

type ReplyMetadata = {
  inReplyTo?: string;
  references: string[];
};

type SyncedMessageNotice = {
  messageId: string;
  sender: string;
  subject: string;
};

type FolderSyncResult = {
  snapshot: WorkspaceSnapshot;
  newMessages: SyncedMessageNotice[];
};

const nowIso = () => new Date().toISOString();

const displayTime = () =>
  new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());

const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const textPreview = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

const formatMailListTime = (value: string) => {
  if (!value) {
    return displayTime();
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(parsedDate);
};

const folderSortOrder = (kind: string, name: string) => {
  switch (kind) {
    case "inbox":
      return 10;
    case "priority":
      return 20;
    case "drafts":
      return 30;
    case "sent":
      return 40;
    case "archive":
      return 50;
    case "trash":
      return 55;
    case "security":
      return 60;
    default:
      return 100 + name.toLowerCase().charCodeAt(0);
  }
};

const createCapabilities = () => [
  "Single-instance desktop shell",
  "Splash and load-failure handling",
  "Blocked remote renderer requests",
  "Persisted window state",
  "Denied webviews and permission prompts",
  "Encrypted local account secret storage",
  "SQLite-backed local workspace state"
];

const createReleaseTargets = () => [
  {
    os: "linux" as const,
    formats: ["AppImage", "deb"],
    status: "configured" as const,
    note: "Desktop packages are configured for x64 and arm64 release builds."
  },
  {
    os: "windows" as const,
    formats: ["nsis"],
    status: "configured" as const,
    note: "Installer targets are configured. Code signing is still required before shipping."
  },
  {
    os: "macos" as const,
    formats: ["dmg", "zip"],
    status: "configured" as const,
    note: "Hardened runtime is configured. Notarization is still required before shipping."
  }
];

const defaultPreferences: NotificationPreferences = {
  desktopNotifications: true,
  soundAlert: false,
  badgeCount: true,
  syncIntervalMinutes: 1
};

const INVALID_FOLDER_NAMES = new Set(["Folders", "System", "Custom", "All Folders", ""]);

export class MailService {
  private readonly database: DatabaseSync;

  constructor(private readonly input: MailServiceInput) {
    fs.mkdirSync(input.userDataPath, { recursive: true });
    const databasePath = path.join(input.userDataPath, "dejazmach-mail.sqlite");
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.createSchema();
    this.ensureReferenceData();
    this.migrateLegacyGlobalFolders();
    this.purgeLegacySeedDataIfPresent();
    this.purgeLegacyGlobalFoldersIfUnused();
  }

  private createSchema() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        last_sync TEXT NOT NULL,
        unread_count INTEGER NOT NULL DEFAULT 0,
        storage TEXT NOT NULL,
        username TEXT NOT NULL,
        incoming_server TEXT NOT NULL,
        incoming_port INTEGER NOT NULL,
        incoming_security TEXT NOT NULL DEFAULT 'ssl_tls',
        outgoing_server TEXT NOT NULL,
        outgoing_port INTEGER NOT NULL,
        outgoing_security TEXT NOT NULL DEFAULT 'ssl_tls',
        outgoing_auth_method TEXT NOT NULL DEFAULT 'auto',
        needs_reauth INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account_secrets (
        account_id TEXT PRIMARY KEY,
        encrypted_secret BLOB NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        account_id TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'remote',
        sort_order INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        classification TEXT NOT NULL,
        participants_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        folder_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        address TEXT NOT NULL,
        subject TEXT NOT NULL,
        preview TEXT NOT NULL,
        label TEXT NOT NULL,
        time TEXT NOT NULL,
        unread INTEGER NOT NULL,
        trust TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        body TEXT NOT NULL,
        html_body TEXT,
        attachments_json TEXT,
        verified INTEGER NOT NULL,
        content_mode TEXT NOT NULL DEFAULT 'plain',
        remote_message_ref TEXT,
        remote_uid INTEGER,
        remote_sequence INTEGER,
        remote_folder_name TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads (id) ON DELETE CASCADE,
        FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sync_jobs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        status TEXT NOT NULL,
        time TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ledger_entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        severity TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS signatures (
        account_id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        desktop_notifications INTEGER NOT NULL DEFAULT 1,
        sound_alert INTEGER NOT NULL DEFAULT 0,
        badge_count INTEGER NOT NULL DEFAULT 1,
        sync_interval_minutes INTEGER NOT NULL DEFAULT 1
      );
    `);
    this.ensureAccountTransportColumns();
    this.ensureFolderColumns();
    this.ensureMessageRemoteColumns();
    this.database
      .prepare(
        `
          INSERT INTO preferences (id, desktop_notifications, sound_alert, badge_count, sync_interval_minutes)
          VALUES (1, 1, 0, 1, 1)
          ON CONFLICT(id) DO NOTHING
        `
      )
      .run();
  }

  private ensureAccountTransportColumns() {
    const columns = new Set(
      (this.database.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>).map((column) => column.name)
    );

    if (!columns.has("incoming_security")) {
      this.database.exec("ALTER TABLE accounts ADD COLUMN incoming_security TEXT NOT NULL DEFAULT 'ssl_tls';");
    }

    if (!columns.has("outgoing_security")) {
      this.database.exec("ALTER TABLE accounts ADD COLUMN outgoing_security TEXT NOT NULL DEFAULT 'ssl_tls';");
    }

    if (!columns.has("outgoing_auth_method")) {
      this.database.exec("ALTER TABLE accounts ADD COLUMN outgoing_auth_method TEXT NOT NULL DEFAULT 'auto';");
    }

    if (!columns.has("needs_reauth")) {
      this.database.exec("ALTER TABLE accounts ADD COLUMN needs_reauth INTEGER NOT NULL DEFAULT 0;");
    }
  }

  private ensureFolderColumns() {
    const columns = new Set(
      (this.database.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>).map((column) => column.name)
    );

    if (!columns.has("account_id")) {
      this.database.exec("ALTER TABLE folders ADD COLUMN account_id TEXT;");
    }

    if (!columns.has("source")) {
      this.database.exec("ALTER TABLE folders ADD COLUMN source TEXT NOT NULL DEFAULT 'remote';");
    }
  }

  private ensureMessageRemoteColumns() {
    const columns = new Set(
      (this.database.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>).map((column) => column.name)
    );

    if (!columns.has("html_body")) {
      this.database.exec("ALTER TABLE messages ADD COLUMN html_body TEXT;");
    }

    if (!columns.has("attachments_json")) {
      this.database.exec("ALTER TABLE messages ADD COLUMN attachments_json TEXT;");
    }

    if (!columns.has("flagged")) {
      this.database.exec("ALTER TABLE messages ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0;");
    }

    if (!columns.has("to_text")) {
      this.database.exec("ALTER TABLE messages ADD COLUMN to_text TEXT NOT NULL DEFAULT '';");
    }

    if (!columns.has("cc_text")) {
      this.database.exec("ALTER TABLE messages ADD COLUMN cc_text TEXT NOT NULL DEFAULT '';");
    }

    if (!columns.has("remote_message_ref")) {
      this.database.exec("ALTER TABLE messages ADD COLUMN remote_message_ref TEXT;");
    }

    if (!columns.has("remote_uid")) {
      this.database.exec("ALTER TABLE messages ADD COLUMN remote_uid INTEGER;");
    }

    if (!columns.has("remote_sequence")) {
      this.database.exec("ALTER TABLE messages ADD COLUMN remote_sequence INTEGER;");
    }

    if (!columns.has("remote_folder_name")) {
      this.database.exec("ALTER TABLE messages ADD COLUMN remote_folder_name TEXT;");
    }
  }

  private ensureReferenceData() {
    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          address TEXT NOT NULL,
          provider TEXT NOT NULL,
          status TEXT NOT NULL,
          last_sync TEXT NOT NULL,
          unread_count INTEGER NOT NULL DEFAULT 0,
          storage TEXT NOT NULL,
          username TEXT NOT NULL,
          incoming_server TEXT NOT NULL,
          incoming_port INTEGER NOT NULL,
          incoming_security TEXT NOT NULL DEFAULT 'ssl_tls',
          outgoing_server TEXT NOT NULL,
          outgoing_port INTEGER NOT NULL,
          outgoing_security TEXT NOT NULL DEFAULT 'ssl_tls',
          outgoing_auth_method TEXT NOT NULL DEFAULT 'auto',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS folders (
          id TEXT PRIMARY KEY,
          account_id TEXT,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'remote',
          sort_order INTEGER NOT NULL
        );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        folder_id TEXT NOT NULL,
          sender TEXT NOT NULL,
          address TEXT NOT NULL,
          subject TEXT NOT NULL,
          preview TEXT NOT NULL,
          label TEXT NOT NULL,
          time TEXT NOT NULL,
          unread INTEGER NOT NULL,
        trust TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        body TEXT NOT NULL,
        html_body TEXT,
        verified INTEGER NOT NULL,
        content_mode TEXT NOT NULL DEFAULT 'plain',
          remote_message_ref TEXT,
          remote_uid INTEGER,
          remote_sequence INTEGER,
          remote_folder_name TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS drafts (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          to_address TEXT NOT NULL DEFAULT '',
          subject TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          severity TEXT NOT NULL DEFAULT 'info',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS signatures (
          account_id TEXT PRIMARY KEY,
          body TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      const accountRows = this.database.prepare("SELECT id FROM accounts").all() as Array<{ id: string }>;
      for (const account of accountRows) {
        const folderCount = this.database
          .prepare(
            `
              SELECT COUNT(*) AS count
              FROM folders
              WHERE account_id = ?
            `
          )
          .get(account.id) as { count: number };

        if (folderCount.count > 0) {
          continue;
        }

        const hasDraftsFolder = this.database
          .prepare(
            `
              SELECT id
              FROM folders
              WHERE account_id = ?
                AND (kind = 'drafts' OR LOWER(name) = 'drafts')
              LIMIT 1
            `
          )
          .get(account.id) as { id: string } | undefined;

        if (!hasDraftsFolder) {
          this.ensureFolder(account.id, "Drafts", "drafts", "local");
        }
      }
    } catch (error) {
      console.error("Failed to ensure DejAzmach reference data.", error);
    }
  }

  private purgeLegacySeedDataIfPresent() {
    const legacyAccountIds = new Set(["acc-ops", "acc-leadership", "acc-audit"]);
    const accounts = this.database
      .prepare("SELECT id FROM accounts ORDER BY created_at ASC")
      .all() as Array<{ id: string }>;

    if (accounts.length === 0) {
      return;
    }

    const onlyLegacySeedAccounts =
      accounts.length === legacyAccountIds.size && accounts.every((account) => legacyAccountIds.has(account.id));

    if (!onlyLegacySeedAccounts) {
      return;
    }

    this.database.exec(`
      DELETE FROM account_secrets;
      DELETE FROM messages;
      DELETE FROM threads;
      DELETE FROM sync_jobs;
      DELETE FROM ledger_entries;
      DELETE FROM folders;
      DELETE FROM accounts;
    `);
  }

  private purgeLegacyGlobalFoldersIfUnused() {
    const legacyFolderIds = ["folder-priority", "folder-inbox", "folder-security", "folder-drafts", "folder-sent", "folder-archive"];
    const accountsCount = this.database.prepare("SELECT COUNT(*) AS count FROM accounts").get() as { count: number };
    const messagesCount = this.database.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number };

    if (accountsCount.count === 0 && messagesCount.count === 0) {
      this.database
        .prepare(`DELETE FROM folders WHERE id IN (${legacyFolderIds.map(() => "?").join(", ")})`)
        .run(...legacyFolderIds);
    }
  }

  private migrateLegacyGlobalFolders() {
    const legacyFolders = this.database
      .prepare(
        `
          SELECT id
          FROM folders
          WHERE account_id IS NULL
        `
      )
      .all() as Array<{ id: string }>;

    if (legacyFolders.length === 0) {
      return;
    }

    const accounts = this.database.prepare("SELECT id FROM accounts ORDER BY created_at ASC").all() as Array<{ id: string }>;
    const updateFolderAccount = this.database.prepare("UPDATE folders SET account_id = ? WHERE id = ?");
    const folderMessageAccountIds = this.database.prepare(
      `
        SELECT DISTINCT account_id AS accountId
        FROM messages
        WHERE folder_id = ?
          AND account_id IS NOT NULL
      `
    );

    for (const folder of legacyFolders) {
      const messageAccounts = folderMessageAccountIds.all(folder.id) as Array<{ accountId: string }>;
      const uniqueAccountIds = Array.from(new Set(messageAccounts.map((entry) => entry.accountId).filter(Boolean)));

      if (uniqueAccountIds.length === 1) {
        updateFolderAccount.run(uniqueAccountIds[0], folder.id);
        continue;
      }

      if (uniqueAccountIds.length === 0 && accounts.length === 1) {
        updateFolderAccount.run(accounts[0].id, folder.id);
      }
    }

    for (const account of accounts) {
      this.reconcileLocalFolders(account.id);
    }
  }

  private reconcileLocalFolders(accountId: string) {
    const localFolders = this.database
      .prepare(
        `
          SELECT id, name, kind
          FROM folders
          WHERE account_id = ? AND source = 'local'
        `
      )
      .all(accountId) as Array<{ id: string; name: string; kind: WorkspaceSnapshot["folders"][number]["kind"] }>;
    const remoteFolders = this.database
      .prepare(
        `
          SELECT id, name, kind
          FROM folders
          WHERE account_id = ? AND source = 'remote'
        `
      )
      .all(accountId) as Array<{ id: string; name: string; kind: WorkspaceSnapshot["folders"][number]["kind"] }>;

    if (localFolders.length === 0 || remoteFolders.length === 0) {
      return;
    }

    const preferredRemoteByKind = new Map(remoteFolders.map((folder) => [folder.kind, folder]));
    const updateMessageFolder = this.database.prepare(
      "UPDATE messages SET folder_id = ?, label = ?, remote_folder_name = COALESCE(remote_folder_name, ?) WHERE folder_id = ?"
    );
    const deleteFolder = this.database.prepare("DELETE FROM folders WHERE id = ?");

    for (const localFolder of localFolders) {
      const remoteMatch =
        remoteFolders.find((folder) => folder.name.toLowerCase() === localFolder.name.toLowerCase()) ??
        preferredRemoteByKind.get(localFolder.kind);

      if (!remoteMatch) {
        continue;
      }

      updateMessageFolder.run(remoteMatch.id, remoteMatch.name, remoteMatch.name, localFolder.id);
      deleteFolder.run(localFolder.id);
    }
  }

  getWorkspaceSnapshot(context: WorkspaceContext): WorkspaceSnapshot {
    try {
      const accounts = this.database
        .prepare(`
        SELECT
          id,
          name,
          address,
          provider,
          status,
          last_sync AS lastSync,
          unread_count AS unreadCount,
          storage,
          needs_reauth AS needsReauth,
          incoming_server AS incomingServer,
          incoming_port AS incomingPort,
          incoming_security AS incomingSecurity,
          outgoing_server AS outgoingServer,
          outgoing_port AS outgoingPort,
          outgoing_security AS outgoingSecurity
        FROM accounts
        ORDER BY created_at ASC
      `)
        .all()
        .map((account) => ({
          ...account,
          needsReauth: Boolean(account.needsReauth)
        })) as WorkspaceSnapshot["accounts"];

      const folders = this.database
        .prepare(`
        SELECT
          folders.id,
          folders.account_id AS accountId,
          folders.name,
          COALESCE(SUM(CASE WHEN messages.unread = 1 THEN 1 ELSE 0 END), 0) AS count,
          folders.kind
        FROM folders
        LEFT JOIN messages
          ON messages.folder_id = folders.id
         AND messages.account_id = folders.account_id
        GROUP BY folders.id, folders.account_id, folders.name, folders.kind, folders.sort_order
        ORDER BY folders.sort_order ASC, LOWER(folders.name) ASC
      `)
        .all() as WorkspaceSnapshot["folders"];

      const messages = this.database
        .prepare(`
        SELECT
          id,
          thread_id AS threadId,
          account_id AS accountId,
          folder_id AS folderId,
          sender,
          subject,
          preview,
          label,
          time,
          sent_at AS sentAt,
          unread,
          flagged,
          trust
        FROM messages
        ORDER BY COALESCE(remote_uid, 0) DESC, created_at DESC
      `)
        .all()
        .map((row) => ({
          ...row,
          unread: Boolean(row.unread),
          flagged: Boolean(row.flagged)
        })) as WorkspaceSnapshot["messages"];

      const messageRows = this.database
        .prepare(`
        SELECT *
        FROM messages
        ORDER BY created_at DESC
        `)
        .all() as MessageRow[];

      const threads = (
        this.database
          .prepare(`
          SELECT id, subject, classification, participants_json
          FROM threads
          ORDER BY created_at DESC
          `)
          .all() as Array<{
          id: string;
          subject: string;
          classification: string;
          participants_json: string;
        }>
      ).map((thread) => ({
        id: thread.id,
        subject: thread.subject,
        classification: thread.classification,
        participants: JSON.parse(thread.participants_json) as string[],
        messages: messageRows
          .filter((message) => message.thread_id === thread.id)
          .map((message) => ({
            id: message.id,
            sender: message.sender,
            address: message.address,
            to: message.to_text ?? "",
            cc: message.cc_text ?? "",
            sentAt: message.sent_at,
            body: message.body,
            html: message.html_body ?? null,
            attachments: message.attachments_json ? (JSON.parse(message.attachments_json) as Attachment[]) : [],
            verified: Boolean(message.verified),
            contentMode: message.content_mode
          }))
      })) as WorkspaceSnapshot["threads"];

      const syncJobs = this.database
        .prepare(`
        SELECT id, title, detail, status, time
        FROM sync_jobs
        ORDER BY created_at DESC
        `)
        .all() as WorkspaceSnapshot["syncJobs"];

      const transparencyLedger = this.database
        .prepare(`
        SELECT id, title, detail, occurred_at AS occurredAt, severity
        FROM ledger_entries
        ORDER BY created_at DESC
        `)
        .all() as WorkspaceSnapshot["shellState"]["transparencyLedger"];

      return {
        shellState: {
          appName: "DejAzmach",
          version: context.version,
          platform: context.platform,
          environment: context.environment,
          packaged: context.packaged,
          secureDesktopMode: true,
          releaseTargets: createReleaseTargets(),
          capabilities: createCapabilities(),
          securityMetrics: [
            {
              label: "Renderer isolation",
              value: "Context-isolated + sandboxed",
              status: "active",
              detail: "UI code stays outside Node.js and receives only preload-approved capabilities."
            },
            {
              label: "Remote content",
              value: "Blocked by default",
              status: "active",
              detail: "External images, trackers, and unaudited embeds stay off until a visible policy exists."
            },
            {
              label: "Credential storage",
              value: this.input.cipher.isAvailable() ? "Encrypted local vault" : "Metadata only",
              status: this.input.cipher.isAvailable() ? "active" : "monitoring",
              detail: this.input.cipher.isAvailable()
                ? "Account secrets are encrypted locally before being persisted."
                : "Electron safeStorage is unavailable in this environment, so secrets should not be trusted yet."
            },
            {
              label: "Message rendering",
              value: "Plain text by default",
              status: "active",
              detail: "Plain text is available immediately, and HTML can be revealed only after client-side sanitization."
            },
            {
              label: "Local persistence",
              value: "SQLite workspace store",
              status: "active",
              detail: "Accounts, drafts, and message metadata persist across launches in the main process."
            }
          ],
          transparencyLedger
        },
        accounts,
        folders,
        messages,
        threads,
        syncJobs
      };
    } catch (error) {
      console.error("Failed to build workspace snapshot.", error);
      return {
        shellState: {
          appName: "DejAzmach",
          version: context.version,
          platform: context.platform,
          environment: context.environment,
          packaged: context.packaged,
          secureDesktopMode: true,
          releaseTargets: createReleaseTargets(),
          capabilities: createCapabilities(),
          securityMetrics: [
            {
              label: "Workspace database",
              value: "Degraded",
              status: "monitoring",
              detail: "A database error prevented the workspace from loading fully."
            }
          ],
          transparencyLedger: []
        },
        accounts: [],
        folders: [],
        messages: [],
        threads: [],
        syncJobs: []
      };
    }
  }

  private getAccountRecord(accountId: string) {
    return this.database
      .prepare(`
        SELECT
          accounts.id,
          accounts.name,
          accounts.address,
          accounts.provider,
          accounts.username,
          accounts.incoming_server AS incomingServer,
          accounts.incoming_port AS incomingPort,
          accounts.incoming_security AS incomingSecurity,
          accounts.outgoing_server AS outgoingServer,
          accounts.outgoing_port AS outgoingPort,
          accounts.outgoing_security AS outgoingSecurity,
          accounts.outgoing_auth_method AS outgoingAuthMethod,
          accounts.needs_reauth AS needsReauth,
          account_secrets.encrypted_secret AS encryptedSecret
        FROM accounts
        LEFT JOIN account_secrets ON account_secrets.account_id = accounts.id
        WHERE accounts.id = ?
      `)
      .get(accountId) as
      | {
          id: string;
          name: string;
          address: string;
          provider: string;
          username: string;
          incomingServer: string;
          incomingPort: number;
          incomingSecurity: TransportSecurity;
          outgoingServer: string;
          outgoingPort: number;
          outgoingSecurity: TransportSecurity;
          outgoingAuthMethod: SmtpAuthMethod;
          needsReauth: number;
          encryptedSecret?: Buffer;
        }
      | undefined;
  }

  private getAccountPassword(accountId: string) {
    const record = this.getAccountRecord(accountId);

    if (!record) {
      throw new Error("Unknown account.");
    }

    if (record.needsReauth) {
      return null;
    }

    if (!record.encryptedSecret) {
      this.markNeedsReauth(accountId);
      return null;
    }

    if (!this.input.cipher.isAvailable()) {
      throw new Error("The operating system vault is unavailable, so this account cannot be verified safely.");
    }

    const decryptedSecret = this.input.cipher.decryptString(record.encryptedSecret);
    if (!decryptedSecret) {
      this.clearStoredPassword(accountId);
      this.markNeedsReauth(accountId);
      this.addLedgerEntry(
        "Account requires re-authentication",
        `${record.address} could not be decrypted from the local vault and must be set up again.`,
        "critical"
      );
      return null;
    }

    const secretPayload = JSON.parse(decryptedSecret) as { password?: string };
    if (!secretPayload.password) {
      throw new Error("Stored account secret is invalid.");
    }

    return {
      ...record,
      password: secretPayload.password
    };
  }

  private requireAuthenticatedAccount(accountId: string) {
    const account = this.getAccountPassword(accountId);

    if (!account) {
      throw new Error("Account needs re-authentication. Please re-enter your password.");
    }

    return account;
  }

  clearStoredPassword(accountId: string) {
    this.database.prepare("DELETE FROM account_secrets WHERE account_id = ?").run(accountId);
  }

  markNeedsReauth(accountId: string) {
    this.database
      .prepare("UPDATE accounts SET needs_reauth = 1, status = ?, last_sync = ? WHERE id = ?")
      .run("attention", "Re-authentication required", accountId);
  }

  async reauthAccount(accountId: string, password: string, context: WorkspaceContext) {
    const account = this.getAccountRecord(accountId);
    if (!account) {
      throw new Error("Unknown account.");
    }

    if (!this.input.cipher.isAvailable()) {
      throw new Error("The operating system vault is unavailable, so this account cannot be stored safely.");
    }

    const encryptedSecret = this.input.cipher.encryptString(JSON.stringify({ password }));
    this.database
      .prepare(
        `
          INSERT INTO account_secrets (account_id, encrypted_secret, created_at)
          VALUES (?, ?, ?)
          ON CONFLICT(account_id) DO UPDATE SET encrypted_secret = excluded.encrypted_secret
        `
      )
      .run(accountId, encryptedSecret, nowIso());
    this.database
      .prepare("UPDATE accounts SET needs_reauth = 0, status = ?, last_sync = ? WHERE id = ?")
      .run("syncing", "Re-authenticating...", accountId);

    return this.getWorkspaceSnapshot(context);
  }

  private addLedgerEntry(title: string, detail: string, severity: "info" | "notice" | "critical") {
    this.database
      .prepare("INSERT INTO ledger_entries (id, title, detail, occurred_at, severity, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(makeId("ledger"), title, detail, displayTime(), severity, nowIso());
  }

  private addSyncJob(title: string, detail: string, status: "running" | "queued" | "complete") {
    this.database
      .prepare("INSERT INTO sync_jobs (id, title, detail, status, time, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(makeId("sync"), title, detail, status, status === "complete" ? displayTime() : "Now", nowIso());
  }

  private getReplyMetadata(messageId?: string): ReplyMetadata {
    if (!messageId) {
      return {
        references: []
      };
    }

    const message = this.database
      .prepare(
        `
          SELECT remote_message_ref AS remoteMessageRef
          FROM messages
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(messageId) as { remoteMessageRef?: string | null } | undefined;

    const inReplyTo =
      message?.remoteMessageRef && !message.remoteMessageRef.startsWith("seq:")
        ? message.remoteMessageRef
        : undefined;

    return {
      inReplyTo,
      references: inReplyTo ? [inReplyTo] : []
    };
  }

  private ensureFolder(accountId: string, name: string, kind: WorkspaceSnapshot["folders"][number]["kind"], source: "remote" | "local") {
    const existing = this.database
      .prepare(
        "SELECT id FROM folders WHERE account_id = ? AND name = ? AND kind = ? AND source = ? LIMIT 1"
      )
      .get(accountId, name, kind, source) as { id: string } | undefined;

    if (existing) {
      return existing.id;
    }

    const folderId = makeId("folder");
    this.database
      .prepare("INSERT INTO folders (id, account_id, name, kind, source, sort_order) VALUES (?, ?, ?, ?, ?, ?)")
      .run(folderId, accountId, name, kind, source, folderSortOrder(kind, name));
    return folderId;
  }

  private findFolderId(accountId: string, kind: WorkspaceSnapshot["folders"][number]["kind"], name?: string) {
    const folder = this.database
      .prepare(
        `
          SELECT id
          FROM folders
          WHERE account_id = ?
            AND kind = ?
            ${name ? "AND name = ?" : ""}
          ORDER BY source DESC, sort_order ASC
          LIMIT 1
        `
      )
      .get(...(name ? [accountId, kind, name] : [accountId, kind])) as { id: string } | undefined;

    return folder?.id ?? "";
  }

  private findFolderRecord(accountId: string, folderName: string) {
    return this.database
      .prepare(
        `
          SELECT id, name, kind
          FROM folders
          WHERE account_id = ? AND name = ?
          ORDER BY source DESC, sort_order ASC
          LIMIT 1
        `
      )
      .get(accountId, folderName) as
      | {
          id: string;
          name: string;
          kind: WorkspaceSnapshot["folders"][number]["kind"];
        }
      | undefined;
  }

  private updateAccountUnreadCount(accountId: string) {
    const unread = this.database
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE account_id = ? AND unread = 1")
      .get(accountId) as { count: number };

    this.database.prepare("UPDATE accounts SET unread_count = ? WHERE id = ?").run(unread.count, accountId);
  }

  private removeLocalMessage(messageId: string, accountId: string) {
    this.database.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
    this.pruneOrphanThreads();
    this.updateAccountUnreadCount(accountId);
  }

  private moveLocalMessage(messageId: string, accountId: string, targetFolderId: string, targetFolderName: string) {
    this.database
      .prepare("UPDATE messages SET folder_id = ?, label = ?, remote_folder_name = COALESCE(remote_folder_name, ?) WHERE id = ?")
      .run(targetFolderId, targetFolderName, targetFolderName, messageId);
    this.updateAccountUnreadCount(accountId);
  }

  private getRemoteMessageRecord(accountId: string, messageId: string) {
    return this.database
      .prepare(
        `
          SELECT
            id,
            account_id AS accountId,
            remote_message_ref AS remoteMessageRef,
            remote_uid AS remoteUid,
            remote_sequence AS remoteSequence,
            remote_folder_name AS remoteFolderName,
            content_mode AS contentMode
          FROM messages
          WHERE id = ? AND account_id = ?
          LIMIT 1
        `
      )
      .get(messageId, accountId) as
      | {
          id: string;
          accountId: string;
          remoteMessageRef?: string | null;
          remoteUid?: number | null;
          remoteSequence?: number | null;
            remoteFolderName?: string | null;
            flagged?: number | null;
          contentMode: MessageContentMode;
        }
      | undefined;
  }

  private pruneOrphanThreads() {
    this.database.exec(`
      DELETE FROM threads
      WHERE id NOT IN (
        SELECT DISTINCT thread_id
        FROM messages
      )
    `);
  }

  private upsertRemoteHeaders(
    accountId: string,
    folderId: string,
    folderName: string,
    headers: InboxHeader[]
  ) {
    // Determine the highest UID already stored for this folder before this sync.
    // If none exist (first sync), suppress all notifications — the user hasn't
    // "seen" these messages yet but they're not new arrivals to alert about.
    const prevMaxRow = this.database
      .prepare("SELECT MAX(remote_uid) AS maxUid FROM messages WHERE account_id = ? AND folder_id = ?")
      .get(accountId, folderId) as { maxUid: number | null };
    const previousMaxUid = prevMaxRow.maxUid ?? 0;
    const isFirstSync = previousMaxUid === 0;

    const newMessages: SyncedMessageNotice[] = [];
    const seenRemoteRefs = new Set<string>();
    const findExisting = this.database.prepare(
      `
        SELECT id, thread_id AS threadId, content_mode AS contentMode, body
        FROM messages
        WHERE account_id = ? AND (remote_uid = ? OR remote_message_ref = ?)
        LIMIT 1
      `
    );
    const insertThread = this.database.prepare(
      "INSERT INTO threads (id, subject, classification, participants_json, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const updateThread = this.database.prepare(
      "UPDATE threads SET subject = ?, classification = ?, participants_json = ? WHERE id = ?"
    );
    const insertMessage = this.database.prepare(`
      INSERT INTO messages (
        id, thread_id, account_id, folder_id, sender, address, subject, preview, label, time,
        unread, trust, sent_at, body, html_body, attachments_json, verified, content_mode,
        to_text, cc_text, remote_message_ref, remote_uid, remote_sequence, remote_folder_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateMessage = this.database.prepare(`
      UPDATE messages
      SET
        folder_id = ?,
        sender = ?,
        address = ?,
        subject = ?,
        preview = ?,
        label = ?,
        time = ?,
        unread = ?,
        trust = ?,
        sent_at = ?,
        verified = ?,
        to_text = ?,
        cc_text = ?,
        remote_uid = ?,
        remote_sequence = ?,
        remote_folder_name = ?
      WHERE id = ?
    `);

    for (const header of headers) {
      seenRemoteRefs.add(header.remoteMessageRef);

      const sender = header.fromName || header.fromAddress || "Unknown sender";
      const sentAt = header.date || "Unknown date";
      const preview = header.preview.trim();
      const participants = JSON.stringify([header.fromAddress || sender]);
      const existing = findExisting.get(accountId, header.uid, header.remoteMessageRef) as
        | {
            id: string;
            threadId: string;
            contentMode: MessageContentMode;
            body: string;
          }
        | undefined;

      if (existing) {
        updateThread.run(header.subject, folderName, participants, existing.threadId);
        updateMessage.run(
          folderId,
          sender,
          header.fromAddress || sender,
          header.subject,
          preview,
          folderName,
          formatMailListTime(header.date),
          header.unread ? 1 : 0,
          "review",
          sentAt,
          1,
          header.to ?? "",
          header.cc ?? "",
          header.uid,
          header.sequence,
          folderName,
          existing.id
        );
        continue;
      }

      const createdAt = nowIso();
      const threadId = makeId("thread");
      const messageId = makeId("message");
      insertThread.run(threadId, header.subject, folderName, participants, createdAt);
      insertMessage.run(
        messageId,
        threadId,
        accountId,
        folderId,
        sender,
        header.fromAddress || sender,
        header.subject,
        preview,
        folderName,
        formatMailListTime(header.date),
        header.unread ? 1 : 0,
        "review",
        sentAt,
        "Message body not loaded yet. Open this message to fetch the full RFC822 body from IMAP.",
        null,
        "[]",
        1,
        "remote-pending",
        header.to ?? "",
        header.cc ?? "",
        header.remoteMessageRef,
        header.uid,
        header.sequence,
        folderName,
        createdAt
      );
      // Only notify if this is not the first sync AND the message's UID is
      // strictly higher than what existed before (i.e. it arrived after our last check).
      if (!isFirstSync && header.uid > previousMaxUid) {
        newMessages.push({
          messageId,
          sender,
          subject: header.subject
        });
      }
    }

    if (seenRemoteRefs.size > 0) {
      const placeholders = Array.from(seenRemoteRefs, () => "?").join(", ");
      this.database
        .prepare(
          `
            DELETE FROM messages
            WHERE account_id = ?
              AND remote_folder_name = ?
              AND remote_message_ref IS NOT NULL
              AND remote_message_ref NOT IN (${placeholders})
          `
        )
        .run(accountId, folderName, ...Array.from(seenRemoteRefs));
    } else {
      this.database
        .prepare(
          `
            DELETE FROM messages
            WHERE account_id = ?
              AND remote_folder_name = ?
              AND remote_message_ref IS NOT NULL
          `
        )
        .run(accountId, folderName);
    }

    this.pruneOrphanThreads();
    this.updateAccountUnreadCount(accountId);
    return newMessages;
  }

  private replaceRemoteFolders(
    accountId: string,
    folders: Array<{ name: string; kind: WorkspaceSnapshot["folders"][number]["kind"] }>
  ) {
    console.log(`[folders] received ${folders.length} folders for account ${accountId}`);
    this.database
      .prepare("DELETE FROM folders WHERE account_id = ? AND account_id IS NOT NULL")
      .run(accountId);

    const insertFolder = this.database.prepare(
      "INSERT INTO folders (id, account_id, name, kind, source, sort_order) VALUES (?, ?, ?, ?, 'remote', ?)"
    );

    for (const folder of folders) {
      console.log(`[folders] inserting folder for ${accountId}: ${folder.name}`);
      insertFolder.run(makeId("folder"), accountId, folder.name, folder.kind, folderSortOrder(folder.kind, folder.name));
    }

    if (folders.length === 0) {
      this.ensureFolder(accountId, "Drafts", "drafts", "local");
    }

    const persistedCount = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM folders
          WHERE account_id = ?
        `
      )
      .get(accountId) as { count: number };
    console.log(`[folders] persisted ${persistedCount.count} folders for account ${accountId}`);
  }

  createAccount(input: CreateAccountInput, context: WorkspaceContext): WorkspaceSnapshot {
    const accountId = makeId("account");
    const createdAt = nowIso();
    const storage = this.input.cipher.isAvailable() ? "OS vault" : "Metadata only";

    this.database
      .prepare(`
        INSERT INTO accounts (
          id, name, address, provider, status, last_sync, unread_count, storage, username,
          incoming_server, incoming_port, incoming_security, outgoing_server, outgoing_port, outgoing_security,
          outgoing_auth_method, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        accountId,
        input.name,
        input.address,
        input.provider,
        "online",
        "Just now",
        0,
        storage,
        input.username,
        input.incomingServer,
        input.incomingPort,
        input.incomingSecurity,
        input.outgoingServer,
        input.outgoingPort,
        input.outgoingSecurity,
        input.outgoingAuthMethod,
        createdAt
      );

    if (this.input.cipher.isAvailable() && input.password) {
      this.database
        .prepare("INSERT INTO account_secrets (account_id, encrypted_secret, created_at) VALUES (?, ?, ?)")
        .run(
          accountId,
          this.input.cipher.encryptString(JSON.stringify({ password: input.password })),
          createdAt
        );
    }

    this.database
      .prepare("INSERT INTO ledger_entries (id, title, detail, occurred_at, severity, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        makeId("ledger"),
        "Account added to local workspace",
        `${input.address} was stored in the main-process account registry. ${this.input.cipher.isAvailable() ? "Secret material was encrypted before persistence." : "Secret material was not encrypted because the vault is unavailable."}`,
        displayTime(),
        this.input.cipher.isAvailable() ? "info" : "critical",
        createdAt
      );

    return this.getWorkspaceSnapshot(context);
  }

  createDraft(input: CreateDraftInput, context: WorkspaceContext): WorkspaceSnapshot {
    const createdAt = nowIso();
    const threadId = makeId("thread");
    const subject = input.subject.trim() || "Untitled draft";
    const body = input.body.trim();
    const account = this.database
      .prepare("SELECT name, address FROM accounts WHERE id = ?")
      .get(input.accountId) as { name: string; address: string } | undefined;

    if (!account) {
      throw new Error("Cannot create a draft for an unknown account.");
    }

    const draftsFolderId = this.findFolderId(input.accountId, "drafts") || this.ensureFolder(input.accountId, "Drafts", "drafts", "local");

    this.database
      .prepare("INSERT INTO threads (id, subject, classification, participants_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(threadId, subject, "Draft", JSON.stringify([account.address, input.to, input.cc ?? ""]), createdAt);

    this.database
      .prepare(`
        INSERT INTO messages (
          id, thread_id, account_id, folder_id, sender, address, subject, preview, label, time,
          unread, trust, sent_at, body, html_body, attachments_json, verified, content_mode, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        makeId("message"),
        threadId,
        input.accountId,
        draftsFolderId,
        account.name,
        account.address,
        subject,
        textPreview(body || "Empty draft"),
        "Draft",
        displayTime(),
        0,
        "trusted",
        `Today, ${displayTime()}`,
        `To: ${input.to || "Not specified"}${input.cc?.trim() ? `\nCc: ${input.cc.trim()}` : ""}\n\n${body || "Empty draft"}`,
        null,
        "[]",
        1,
        "plain",
        createdAt
      );

    this.database
      .prepare("INSERT INTO ledger_entries (id, title, detail, occurred_at, severity, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        makeId("ledger"),
        "Draft stored locally",
        `A draft for ${input.to || "unspecified recipient"} was persisted in the local SQLite workspace.`,
        displayTime(),
        "info",
        createdAt
      );

    return this.getWorkspaceSnapshot(context);
  }

  listAccountsForSync() {
    try {
      return this.database
        .prepare(
          `
          SELECT id, address, needs_reauth AS needsReauth
          FROM accounts
          ORDER BY created_at ASC
          `
        )
        .all()
        .map((account) => ({
          ...account,
          needsReauth: Boolean(account.needsReauth)
        })) as Array<{ id: string; address: string; needsReauth: boolean }>;
    } catch (error) {
      console.error("Failed to list accounts for sync.", error);
      return [];
    }
  }

  getPreferences(): NotificationPreferences {
    try {
      const row = this.database
        .prepare(
          `
          SELECT
            desktop_notifications AS desktopNotifications,
            sound_alert AS soundAlert,
            badge_count AS badgeCount,
            sync_interval_minutes AS syncIntervalMinutes
          FROM preferences
          WHERE id = 1
          `
        )
        .get() as
        | {
            desktopNotifications: number;
            soundAlert: number;
            badgeCount: number;
            syncIntervalMinutes: number;
          }
        | undefined;

      if (!row) {
        return defaultPreferences;
      }

      return {
        desktopNotifications: Boolean(row.desktopNotifications),
        soundAlert: Boolean(row.soundAlert),
        badgeCount: Boolean(row.badgeCount),
        syncIntervalMinutes: [1, 5, 15, 30, 60].includes(row.syncIntervalMinutes)
          ? (row.syncIntervalMinutes as NotificationPreferences["syncIntervalMinutes"])
          : 1
      };
    } catch (error) {
      console.error("Failed to load notification preferences.", error);
      return defaultPreferences;
    }
  }

  setPreferences(input: NotificationPreferences) {
    this.database
      .prepare(
        `
          INSERT INTO preferences (id, desktop_notifications, sound_alert, badge_count, sync_interval_minutes)
          VALUES (1, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            desktop_notifications = excluded.desktop_notifications,
            sound_alert = excluded.sound_alert,
            badge_count = excluded.badge_count,
            sync_interval_minutes = excluded.sync_interval_minutes
        `
      )
      .run(
        input.desktopNotifications ? 1 : 0,
        input.soundAlert ? 1 : 0,
        input.badgeCount ? 1 : 0,
        input.syncIntervalMinutes
      );

    return this.getPreferences();
  }

  updateAccountDisplayName(input: UpdateAccountDisplayNameInput, context: WorkspaceContext) {
    this.database.prepare("UPDATE accounts SET name = ? WHERE id = ?").run(input.name.trim() || "Mailbox", input.accountId);
    return this.getWorkspaceSnapshot(context);
  }

  updateAccountImap(input: UpdateAccountImapInput, context: WorkspaceContext) {
    this.database
      .prepare("UPDATE accounts SET incoming_server = ?, incoming_port = ?, incoming_security = ? WHERE id = ?")
      .run(input.incomingServer, input.incomingPort, input.incomingSecurity, input.accountId);
    return this.getWorkspaceSnapshot(context);
  }

  updateAccountSmtp(input: UpdateAccountSmtpInput, context: WorkspaceContext) {
    this.database
      .prepare("UPDATE accounts SET outgoing_server = ?, outgoing_port = ?, outgoing_security = ? WHERE id = ?")
      .run(input.outgoingServer, input.outgoingPort, input.outgoingSecurity, input.accountId);
    return this.getWorkspaceSnapshot(context);
  }

  deleteAccount(accountId: string, context: WorkspaceContext) {
    const threadIds = (
      this.database
        .prepare("SELECT DISTINCT thread_id AS threadId FROM messages WHERE account_id = ?")
        .all(accountId) as Array<{ threadId: string }>
    ).map((thread) => thread.threadId);

    this.database.prepare("DELETE FROM account_secrets WHERE account_id = ?").run(accountId);
    this.database.prepare("DELETE FROM signatures WHERE account_id = ?").run(accountId);
    this.database.prepare("DELETE FROM messages WHERE account_id = ?").run(accountId);
    this.database.prepare("DELETE FROM folders WHERE account_id = ?").run(accountId);
    this.database.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);

    if (threadIds.length > 0) {
      this.database
        .prepare(`DELETE FROM threads WHERE id IN (${threadIds.map(() => "?").join(", ")})`)
        .run(...threadIds);
    }

    this.pruneOrphanThreads();
    return this.getWorkspaceSnapshot(context);
  }

  async syncFolderWithResult(
    input: SyncFolderInput & { limit?: number },
    context: WorkspaceContext,
    options?: { recordActivity?: boolean }
  ): Promise<FolderSyncResult> {
    const normalizedFolderName = input.folderName.trim();
    if (INVALID_FOLDER_NAMES.has(normalizedFolderName)) {
      throw new Error(`Invalid folder name: "${input.folderName}" — this is not a real IMAP folder`);
    }

    const account = this.requireAuthenticatedAccount(input.accountId);
    const folderRecord =
      this.findFolderRecord(input.accountId, normalizedFolderName) ??
      ({
        id: this.ensureFolder(input.accountId, normalizedFolderName, "custom", "remote"),
        name: normalizedFolderName,
        kind: "custom" as const
      });
    const recordActivity = options?.recordActivity ?? true;

    try {
      const summary = await fetchImapFolderHeaders({
        username: account.username,
        password: account.password,
        incomingServer: account.incomingServer,
        incomingPort: account.incomingPort,
        incomingSecurity: account.incomingSecurity,
        folderName: normalizedFolderName,
        limit: input.limit
      });

      const newMessages = this.upsertRemoteHeaders(input.accountId, folderRecord.id, folderRecord.name, summary.headers);
      this.database
        .prepare("UPDATE accounts SET status = ?, last_sync = ? WHERE id = ?")
        .run("online", `Synced ${displayTime()}`, input.accountId);

      if (recordActivity) {
        this.addSyncJob(`Folder sync for ${account.address}`, `${normalizedFolderName} refreshed from IMAP.`, "complete");
        this.addLedgerEntry(
          "Folder sync completed",
          `${account.address} refreshed ${normalizedFolderName} and stored ${summary.headers.length} headers locally.`,
          "info"
        );
      } else if (newMessages.length > 0) {
        this.addLedgerEntry(
          "Background inbox sync completed",
          `${account.address} received ${newMessages.length} new message${newMessages.length === 1 ? "" : "s"} in ${normalizedFolderName}.`,
          "notice"
        );
      }

      return {
        snapshot: this.getWorkspaceSnapshot(context),
        newMessages
      };
    } catch (error) {
      const message = describeTransportError(error, "IMAP", account.incomingServer, account.incomingPort);
      this.database
        .prepare("UPDATE accounts SET status = ?, last_sync = ? WHERE id = ?")
        .run("attention", `Sync failed ${displayTime()}`, input.accountId);

      if (recordActivity) {
        this.addLedgerEntry("Folder sync failed", `${account.address}: ${message}`, "critical");
      }

      throw new Error(message);
    }
  }

  async verifyAccount(accountId: string, context: WorkspaceContext) {
    const account = this.requireAuthenticatedAccount(accountId);

    this.database
      .prepare("UPDATE accounts SET status = ?, last_sync = ? WHERE id = ?")
      .run("syncing", "Verifying...", accountId);

    this.addSyncJob(
      `Connectivity verification for ${account.address}`,
      `Testing IMAP ${account.incomingServer}:${account.incomingPort} and SMTP ${account.outgoingServer}:${account.outgoingPort}.`,
      "running"
    );

    try {
      const summary = await verifyAccountConnection({
        username: account.username,
        password: account.password,
        address: account.address,
        incomingServer: account.incomingServer,
        incomingPort: account.incomingPort,
        incomingSecurity: account.incomingSecurity,
        outgoingServer: account.outgoingServer,
        outgoingPort: account.outgoingPort,
        outgoingSecurity: account.outgoingSecurity,
        outgoingAuthMethod: account.outgoingAuthMethod
      });

      this.replaceRemoteFolders(
        accountId,
        summary.imap.folders.map((folder) => ({ name: folder.name, kind: folder.kind }))
      );
      const inboxFolder =
        summary.imap.folders.find((folder) => folder.kind === "inbox") ??
        { name: "INBOX", kind: "inbox" as const };
      const inboxFolderId =
        this.findFolderId(accountId, "inbox", inboxFolder.name) || this.findFolderId(accountId, "inbox");

      if (inboxFolderId) {
        this.upsertRemoteHeaders(accountId, inboxFolderId, inboxFolder.name, summary.imap.headers);
      }

      this.database
        .prepare("UPDATE accounts SET status = ?, last_sync = ?, unread_count = ? WHERE id = ?")
        .run("online", `Verified ${displayTime()}`, Number(summary.imap.unseen ?? 0), accountId);

      this.addLedgerEntry(
        "Provider verification succeeded",
        `${account.address} passed IMAP and SMTP verification. ${summary.imap.folders.length} folders discovered. ${summary.imap.headers.length} inbox headers synced. Inbox unseen count is ${summary.imap.unseen ?? "unknown"}.`,
        "info"
      );
      this.addSyncJob(`Connectivity verification for ${account.address}`, "IMAP and SMTP verification completed.", "complete");

      return this.getWorkspaceSnapshot(context);
    } catch (error) {
      const message = describeTransportError(
        error,
        "IMAP",
        account.incomingServer,
        account.incomingPort
      );
      this.database
        .prepare("UPDATE accounts SET status = ?, last_sync = ? WHERE id = ?")
        .run("attention", `Verification failed ${displayTime()}`, accountId);

      this.addLedgerEntry("Provider verification failed", `${account.address}: ${message}`, "critical");
      this.addSyncJob(`Connectivity verification for ${account.address}`, message, "complete");
      throw new Error(message);
    }
  }

  async sendMessage(input: SendMessageInput, context: WorkspaceContext) {
    const account = this.requireAuthenticatedAccount(input.accountId);
    const subject = input.subject.trim() || "No subject";
    const body = input.body.trim();
    const replyMetadata = this.getReplyMetadata(input.replyToMessageId);

    if (!input.to.trim()) {
      throw new Error("Recipient address is required before sending.");
    }

    const sentFolderId = this.findFolderId(input.accountId, "sent") || this.ensureFolder(input.accountId, "Sent", "sent", "local");

    try {
      await sendPlainTextMessage({
        username: account.username,
        password: account.password,
        fromAddress: account.address,
        fromName: account.name,
        outgoingServer: account.outgoingServer,
        outgoingPort: account.outgoingPort,
        outgoingSecurity: account.outgoingSecurity,
        outgoingAuthMethod: account.outgoingAuthMethod,
        to: input.to.trim(),
        cc: input.cc?.trim(),
        bcc: input.bcc?.filter(Boolean),
        subject,
        body,
        htmlBody: input.htmlBody,
        attachments: input.attachments?.map((a) => ({ filename: a.filename, mimeType: a.mimeType, data: a.data })),
        inReplyTo: replyMetadata.inReplyTo,
        references: replyMetadata.references
      });

      const createdAt = nowIso();
      const threadId = makeId("thread");

      this.database
        .prepare("INSERT INTO threads (id, subject, classification, participants_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(threadId, subject, "Sent", JSON.stringify([account.address, input.to.trim(), input.cc?.trim() ?? ""]), createdAt);

      this.database
      .prepare(`
        INSERT INTO messages (
          id, thread_id, account_id, folder_id, sender, address, subject, preview, label, time,
          unread, trust, sent_at, body, html_body, attachments_json, verified, content_mode, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          makeId("message"),
          threadId,
          input.accountId,
          sentFolderId,
          account.name,
          account.address,
          subject,
          textPreview(body || "Empty message"),
          "Sent",
          displayTime(),
          0,
          "encrypted",
          `Today, ${displayTime()}`,
          `To: ${input.to.trim()}${input.cc?.trim() ? `\nCc: ${input.cc.trim()}` : ""}\n\n${body || "Empty message"}`,
          null,
          "[]",
          1,
          "plain",
          createdAt
        );

      this.database
        .prepare("UPDATE accounts SET status = ?, last_sync = ? WHERE id = ?")
        .run("online", `Sent ${displayTime()}`, input.accountId);

      this.addLedgerEntry(
        "Outbound message submitted",
        `${account.address} sent a message to ${input.to.trim()} through ${account.outgoingServer}:${account.outgoingPort}.`,
        "info"
      );
      this.addSyncJob(`Outbound delivery for ${account.address}`, `Message submitted to ${input.to.trim()}.`, "complete");

      return this.getWorkspaceSnapshot(context);
    } catch (error) {
      const message = describeTransportError(
        error,
        "SMTP",
        account.outgoingServer,
        account.outgoingPort
      );

      this.database
        .prepare("UPDATE accounts SET status = ?, last_sync = ? WHERE id = ?")
        .run("attention", `Send failed ${displayTime()}`, input.accountId);

      this.addLedgerEntry("Outbound delivery failed", `${account.address}: ${message}`, "critical");
      this.addSyncJob(`Outbound delivery for ${account.address}`, message, "complete");
      throw new Error(message);
    }
  }

  async syncFolder(input: SyncFolderInput, context: WorkspaceContext) {
    const result = await this.syncFolderWithResult(input, context, { recordActivity: true });
    return result.snapshot;
  }

  async fetchMessageBody(input: FetchMessageBodyInput, _context: WorkspaceContext): Promise<FetchMessageBodyResult> {
    const remoteMessage = this.getRemoteMessageRecord(input.accountId, input.messageId);

    if (!remoteMessage) {
      // Message was pruned by a concurrent sync — return empty body rather than surfacing an error.
      return { body: "", html: null, attachments: [] };
    }

    if (remoteMessage.accountId !== input.accountId) {
      throw new Error("Message does not belong to the requested account.");
    }

    if (remoteMessage.contentMode !== "remote-pending") {
      const currentBody = this.database
        .prepare("SELECT body, html_body AS html, attachments_json AS attachmentsJson FROM messages WHERE id = ?")
        .get(input.messageId) as
        | {
            body: string;
            html?: string | null;
            attachmentsJson?: string | null;
          }
        | undefined;

      return {
        body: currentBody?.body ?? "",
        html: currentBody?.html ?? null,
        attachments: currentBody?.attachmentsJson ? (JSON.parse(currentBody.attachmentsJson) as Attachment[]) : []
      };
    }

    if (!remoteMessage.remoteUid || !remoteMessage.remoteFolderName) {
      throw new Error("This message does not have a remote IMAP body to fetch.");
    }

    const account = this.requireAuthenticatedAccount(remoteMessage.accountId);

    try {
      const fetchedContent = await fetchImapMessageBody({
        username: account.username,
        password: account.password,
        incomingServer: account.incomingServer,
        incomingPort: account.incomingPort,
        incomingSecurity: account.incomingSecurity,
        folderName: remoteMessage.remoteFolderName,
        uid: remoteMessage.remoteUid
      });
      const contentMode: MessageContentMode = "plain";

      this.database
        .prepare("UPDATE messages SET body = ?, html_body = ?, attachments_json = ?, content_mode = ?, to_text = ?, cc_text = ? WHERE id = ?")
        .run(
          fetchedContent.body,
          fetchedContent.html,
          JSON.stringify(fetchedContent.attachments),
          contentMode,
          fetchedContent.to ?? "",
          fetchedContent.cc ?? "",
          input.messageId
        );

      this.addLedgerEntry(
        "Message body fetched from IMAP",
        `${account.address} loaded the full RFC822 body for message ${input.messageId}.`,
        "info"
      );

      return {
        body: fetchedContent.body,
        html: fetchedContent.html,
        attachments: fetchedContent.attachments,
        to: fetchedContent.to,
        cc: fetchedContent.cc
      };
    } catch (error) {
      const message = describeTransportError(
        error,
        "IMAP",
        account.incomingServer,
        account.incomingPort
      );
      this.addLedgerEntry("Message body fetch failed", `${account.address}: ${message}`, "critical");
      throw new Error(message);
    }
  }

  async deleteMessage(input: MessageMutationInput, context: WorkspaceContext) {
    const remoteMessage = this.getRemoteMessageRecord(input.accountId, input.messageId);

    if (!remoteMessage) {
      // Already gone (pruned by a concurrent sync) — return a fresh snapshot.
      return this.getWorkspaceSnapshot(context);
    }

    if (remoteMessage.accountId !== input.accountId) {
      throw new Error("Message does not belong to the requested account.");
    }

    if (!remoteMessage.remoteUid || !remoteMessage.remoteFolderName) {
      this.removeLocalMessage(input.messageId, input.accountId);
      return this.getWorkspaceSnapshot(context);
    }

    const account = this.requireAuthenticatedAccount(input.accountId);

    try {
      await deleteImapMessage({
        username: account.username,
        password: account.password,
        incomingServer: account.incomingServer,
        incomingPort: account.incomingPort,
        incomingSecurity: account.incomingSecurity,
        folderName: remoteMessage.remoteFolderName,
        uid: remoteMessage.remoteUid
      });
      this.removeLocalMessage(input.messageId, input.accountId);
      this.addLedgerEntry("Message deleted", `${account.address} deleted a message from ${remoteMessage.remoteFolderName}.`, "info");
      return this.getWorkspaceSnapshot(context);
    } catch (error) {
      const message = describeTransportError(error, "IMAP", account.incomingServer, account.incomingPort);
      this.addLedgerEntry("Message delete failed", `${account.address}: ${message}`, "critical");
      throw new Error(message);
    }
  }

  async markRead(input: MessageMutationInput, context: WorkspaceContext) {
    const remoteMessage = this.getRemoteMessageRecord(input.accountId, input.messageId);

    if (!remoteMessage) {
      return this.getWorkspaceSnapshot(context);
    }

    if (remoteMessage.accountId !== input.accountId) {
      throw new Error("Message does not belong to the requested account.");
    }

    if (remoteMessage.remoteUid && remoteMessage.remoteFolderName) {
      const account = this.requireAuthenticatedAccount(input.accountId);

      try {
        await markImapMessageRead({
          username: account.username,
          password: account.password,
          incomingServer: account.incomingServer,
          incomingPort: account.incomingPort,
          incomingSecurity: account.incomingSecurity,
          folderName: remoteMessage.remoteFolderName,
          uid: remoteMessage.remoteUid
        });
      } catch (error) {
        const message = describeTransportError(error, "IMAP", account.incomingServer, account.incomingPort);
        this.addLedgerEntry("Mark read failed", `${account.address}: ${message}`, "critical");
        throw new Error(message);
      }
    }

    this.database.prepare("UPDATE messages SET unread = 0 WHERE id = ?").run(input.messageId);
    this.updateAccountUnreadCount(input.accountId);
    return this.getWorkspaceSnapshot(context);
  }

  getSignature(accountId: string) {
    const signature = this.database
      .prepare("SELECT body FROM signatures WHERE account_id = ? LIMIT 1")
      .get(accountId) as { body: string } | undefined;

    return {
      body: signature?.body ?? ""
    };
  }

  setSignature(accountId: string, body: string) {
    this.database
      .prepare(
        `
          INSERT INTO signatures (account_id, body, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(account_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at
        `
      )
      .run(accountId, body, Date.now());

    return {
      body
    };
  }

  async markUnread(input: MessageMutationInput, context: WorkspaceContext) {
    const remoteMessage = this.getRemoteMessageRecord(input.accountId, input.messageId);

    if (!remoteMessage) {
      return this.getWorkspaceSnapshot(context);
    }

    if (remoteMessage.remoteUid && remoteMessage.remoteFolderName) {
      const account = this.requireAuthenticatedAccount(input.accountId);

      try {
        await markImapMessageUnread({
          username: account.username,
          password: account.password,
          incomingServer: account.incomingServer,
          incomingPort: account.incomingPort,
          incomingSecurity: account.incomingSecurity,
          folderName: remoteMessage.remoteFolderName,
          uid: remoteMessage.remoteUid
        });
      } catch (error) {
        const message = describeTransportError(error, "IMAP", account.incomingServer, account.incomingPort);
        this.addLedgerEntry("Mark unread failed", `${account.address}: ${message}`, "critical");
        throw new Error(message);
      }
    }

    this.database.prepare("UPDATE messages SET unread = 1 WHERE id = ?").run(input.messageId);
    this.updateAccountUnreadCount(input.accountId);
    return this.getWorkspaceSnapshot(context);
  }

  async toggleFlag(input: ToggleFlagInput, context: WorkspaceContext) {
    const remoteMessage = this.getRemoteMessageRecord(input.accountId, input.messageId);

    if (!remoteMessage) {
      return this.getWorkspaceSnapshot(context);
    }

    if (remoteMessage.remoteUid && remoteMessage.remoteFolderName) {
      const account = this.requireAuthenticatedAccount(input.accountId);

      try {
        await toggleImapMessageFlag({
          username: account.username,
          password: account.password,
          incomingServer: account.incomingServer,
          incomingPort: account.incomingPort,
          incomingSecurity: account.incomingSecurity,
          folderName: remoteMessage.remoteFolderName,
          uid: remoteMessage.remoteUid,
          flagged: input.flagged
        });
      } catch (error) {
        const message = describeTransportError(error, "IMAP", account.incomingServer, account.incomingPort);
        this.addLedgerEntry("Flag update failed", `${account.address}: ${message}`, "critical");
        throw new Error(message);
      }
    }

    this.database.prepare("UPDATE messages SET flagged = ? WHERE id = ?").run(input.flagged ? 1 : 0, input.messageId);
    return this.getWorkspaceSnapshot(context);
  }

  async markSpam(input: MessageMutationInput, context: WorkspaceContext) {
    const spamFolder = this.database
      .prepare(
        `
          SELECT name
          FROM folders
          WHERE account_id = ?
            AND LOWER(name) IN ('spam', 'junk', 'junk email')
          ORDER BY sort_order ASC
          LIMIT 1
        `
      )
      .get(input.accountId) as { name: string } | undefined;

    if (!spamFolder) {
      throw new Error("No spam folder is available for this account.");
    }

    return this.moveMessage(
      {
        accountId: input.accountId,
        messageId: input.messageId,
        targetFolderName: spamFolder.name
      },
      context
    );
  }

  async moveMessage(input: { accountId: string; messageId: string; targetFolderName: string }, context: WorkspaceContext) {
    const remoteMessage = this.getRemoteMessageRecord(input.accountId, input.messageId);

    if (!remoteMessage) {
      return this.getWorkspaceSnapshot(context);
    }

    const targetFolder =
      this.findFolderRecord(input.accountId, input.targetFolderName) ??
      ({
        id: this.ensureFolder(input.accountId, input.targetFolderName, "custom", "remote"),
        name: input.targetFolderName,
        kind: "custom" as const
      });

    if (!remoteMessage.remoteUid || !remoteMessage.remoteFolderName) {
      this.moveLocalMessage(input.messageId, input.accountId, targetFolder.id, targetFolder.name);
      return this.getWorkspaceSnapshot(context);
    }

    const account = this.requireAuthenticatedAccount(input.accountId);

    try {
      await moveImapMessage({
        username: account.username,
        password: account.password,
        incomingServer: account.incomingServer,
        incomingPort: account.incomingPort,
        incomingSecurity: account.incomingSecurity,
        folderName: remoteMessage.remoteFolderName,
        uid: remoteMessage.remoteUid,
        targetFolderName: targetFolder.name
      });
      this.moveLocalMessage(input.messageId, input.accountId, targetFolder.id, targetFolder.name);
      this.addLedgerEntry("Message moved", `${account.address} moved a message to ${targetFolder.name}.`, "info");
      return this.getWorkspaceSnapshot(context);
    } catch (error) {
      const message = describeTransportError(error, "IMAP", account.incomingServer, account.incomingPort);
      this.addLedgerEntry("Message move failed", `${account.address}: ${message}`, "critical");
      throw new Error(message);
    }
  }

  async archiveMessage(input: MessageMutationInput, context: WorkspaceContext) {
    const archiveFolder = this.database
      .prepare(
        `
          SELECT name
          FROM folders
          WHERE account_id = ?
            AND LOWER(name) IN ('archive', 'all mail', '[gmail]/all mail')
          ORDER BY sort_order ASC
          LIMIT 1
        `
      )
      .get(input.accountId) as { name: string } | undefined;

    if (!archiveFolder) {
      throw new Error("No archive folder is available for this account.");
    }

    return this.moveMessage(
      {
        accountId: input.accountId,
        messageId: input.messageId,
        targetFolderName: archiveFolder.name
      },
      context
    );
  }

  close() {
    this.database.close();
  }
}
