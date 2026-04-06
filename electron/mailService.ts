import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CreateAccountInput,
  CreateDraftInput,
  FetchMessageBodyInput,
  FetchMessageBodyResult,
  MessageMutationInput,
  MessageContentMode,
  RuntimeEnvironment,
  SyncFolderInput,
  SmtpAuthMethod,
  TransportSecurity,
  WorkspaceSnapshot
} from "../shared/contracts.js";
import type { InboxHeader } from "./providerClient.js";
import {
  deleteImapMessage,
  describeTransportError,
  fetchImapFolderHeaders,
  fetchImapMessageBody,
  markImapMessageRead,
  sendPlainTextMessage,
  verifyAccountConnection
} from "./providerClient.js";

type Cipher = {
  isAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
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
  verified: number;
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
    `);
    this.ensureAccountTransportColumns();
    this.ensureFolderColumns();
    this.ensureMessageRemoteColumns();
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

  private ensureReferenceData() {}

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

  getWorkspaceSnapshot(context: WorkspaceContext): WorkspaceSnapshot {
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
          storage
        FROM accounts
        ORDER BY created_at ASC
      `)
      .all() as WorkspaceSnapshot["accounts"];

    const folders = this.database
      .prepare(`
        SELECT
          folders.id,
          folders.account_id AS accountId,
          folders.name,
          COUNT(messages.id) AS count,
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
          unread,
          trust
        FROM messages
        ORDER BY created_at DESC
      `)
      .all()
      .map((row) => ({
        ...row,
        unread: Boolean(row.unread)
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
          sentAt: message.sent_at,
          body: message.body,
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
            value: "Plain text or blocked HTML",
            status: "active",
            detail: "The client refuses rich HTML rendering until a sanitizer pipeline is deliberately implemented."
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
          encryptedSecret?: Buffer;
        }
      | undefined;
  }

  private getAccountPassword(accountId: string) {
    const record = this.getAccountRecord(accountId);

    if (!record) {
      throw new Error("Unknown account.");
    }

    if (!record.encryptedSecret) {
      throw new Error("No stored secret exists for this account.");
    }

    if (!this.input.cipher.isAvailable()) {
      throw new Error("The operating system vault is unavailable, so this account cannot be verified safely.");
    }

    const secretPayload = JSON.parse(this.input.cipher.decryptString(record.encryptedSecret)) as { password?: string };
    if (!secretPayload.password) {
      throw new Error("Stored account secret is invalid.");
    }

    return {
      ...record,
      password: secretPayload.password
    };
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
        unread, trust, sent_at, body, verified, content_mode, remote_message_ref, remote_uid, remote_sequence,
        remote_folder_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        remote_uid = ?,
        remote_sequence = ?,
        remote_folder_name = ?
      WHERE id = ?
    `);

    for (const header of headers) {
      seenRemoteRefs.add(header.remoteMessageRef);

      const sender = header.fromName || header.fromAddress || "Unknown sender";
      const sentAt = header.date || "Unknown date";
      const preview = `Header synced from IMAP. ${header.size} bytes on server.`;
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
          header.uid,
          header.sequence,
          folderName,
          existing.id
        );
        continue;
      }

      const createdAt = nowIso();
      const threadId = makeId("thread");
      insertThread.run(threadId, header.subject, folderName, participants, createdAt);
      insertMessage.run(
        makeId("message"),
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
        1,
        "remote-pending",
        header.remoteMessageRef,
        header.uid,
        header.sequence,
        folderName,
        createdAt
      );
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
  }

  private replaceRemoteFolders(
    accountId: string,
    folders: Array<{ name: string; kind: WorkspaceSnapshot["folders"][number]["kind"] }>
  ) {
    const existingFolders = this.database
      .prepare(
        `
          SELECT id, name, kind
          FROM folders
          WHERE account_id = ? AND source = 'remote'
        `
      )
      .all(accountId) as Array<{ id: string; name: string; kind: WorkspaceSnapshot["folders"][number]["kind"] }>;
    const existingByKey = new Map(existingFolders.map((folder) => [`${folder.name}::${folder.kind}`, folder]));
    const seenKeys = new Set<string>();
    const insertFolder = this.database.prepare(
      "INSERT INTO folders (id, account_id, name, kind, source, sort_order) VALUES (?, ?, ?, ?, 'remote', ?)"
    );
    const updateFolder = this.database.prepare(
      "UPDATE folders SET sort_order = ? WHERE id = ?"
    );

    for (const folder of folders) {
      const key = `${folder.name}::${folder.kind}`;
      seenKeys.add(key);
      const existing = existingByKey.get(key);

      if (existing) {
        updateFolder.run(folderSortOrder(folder.kind, folder.name), existing.id);
        continue;
      }

      insertFolder.run(makeId("folder"), accountId, folder.name, folder.kind, folderSortOrder(folder.kind, folder.name));
    }

    for (const folder of existingFolders) {
      const key = `${folder.name}::${folder.kind}`;
      if (!seenKeys.has(key)) {
        this.database.prepare("DELETE FROM folders WHERE id = ?").run(folder.id);
      }
    }
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

    const draftsFolderId = this.ensureFolder(input.accountId, "Drafts", "drafts", "local");

    this.database
      .prepare("INSERT INTO threads (id, subject, classification, participants_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(threadId, subject, "Draft", JSON.stringify([account.address, input.to]), createdAt);

    this.database
      .prepare(`
        INSERT INTO messages (
          id, thread_id, account_id, folder_id, sender, address, subject, preview, label, time,
          unread, trust, sent_at, body, verified, content_mode, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        `To: ${input.to || "Not specified"}\n\n${body || "Empty draft"}`,
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

  async verifyAccount(accountId: string, context: WorkspaceContext) {
    const account = this.getAccountPassword(accountId);

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

  async sendMessage(input: CreateDraftInput, context: WorkspaceContext) {
    const account = this.getAccountPassword(input.accountId);
    const subject = input.subject.trim() || "No subject";
    const body = input.body.trim();
    const replyMetadata = this.getReplyMetadata(input.replyToMessageId);

    if (!input.to.trim()) {
      throw new Error("Recipient address is required before sending.");
    }

    const sentFolderId = this.ensureFolder(input.accountId, "Sent", "sent", "local");

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
        subject,
        body,
        inReplyTo: replyMetadata.inReplyTo,
        references: replyMetadata.references
      });

      const createdAt = nowIso();
      const threadId = makeId("thread");

      this.database
        .prepare("INSERT INTO threads (id, subject, classification, participants_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(threadId, subject, "Sent", JSON.stringify([account.address, input.to.trim()]), createdAt);

      this.database
        .prepare(`
          INSERT INTO messages (
            id, thread_id, account_id, folder_id, sender, address, subject, preview, label, time,
            unread, trust, sent_at, body, verified, content_mode, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          `To: ${input.to.trim()}\n\n${body || "Empty message"}`,
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
    const account = this.getAccountPassword(input.accountId);
    const folderRecord =
      this.findFolderRecord(input.accountId, input.folderName) ??
      ({
        id: this.ensureFolder(input.accountId, input.folderName, "custom", "remote"),
        name: input.folderName,
        kind: "custom" as const
      });

    try {
      const summary = await fetchImapFolderHeaders({
        username: account.username,
        password: account.password,
        incomingServer: account.incomingServer,
        incomingPort: account.incomingPort,
        incomingSecurity: account.incomingSecurity,
        folderName: input.folderName,
        limit: 50
      });

      this.upsertRemoteHeaders(input.accountId, folderRecord.id, folderRecord.name, summary.headers);
      this.database
        .prepare("UPDATE accounts SET status = ?, last_sync = ? WHERE id = ?")
        .run("online", `Synced ${displayTime()}`, input.accountId);
      this.addSyncJob(`Folder sync for ${account.address}`, `${input.folderName} refreshed from IMAP.`, "complete");
      this.addLedgerEntry(
        "Folder sync completed",
        `${account.address} refreshed ${input.folderName} and stored ${summary.headers.length} headers locally.`,
        "info"
      );

      return this.getWorkspaceSnapshot(context);
    } catch (error) {
      const message = describeTransportError(error, "IMAP", account.incomingServer, account.incomingPort);
      this.database
        .prepare("UPDATE accounts SET status = ?, last_sync = ? WHERE id = ?")
        .run("attention", `Sync failed ${displayTime()}`, input.accountId);
      this.addLedgerEntry("Folder sync failed", `${account.address}: ${message}`, "critical");
      throw new Error(message);
    }
  }

  async fetchMessageBody(input: FetchMessageBodyInput, _context: WorkspaceContext): Promise<FetchMessageBodyResult> {
    const remoteMessage = this.getRemoteMessageRecord(input.accountId, input.messageId);

    if (!remoteMessage) {
      throw new Error("Unknown message.");
    }

    if (remoteMessage.accountId !== input.accountId) {
      throw new Error("Message does not belong to the requested account.");
    }

    if (remoteMessage.contentMode !== "remote-pending") {
      const currentBody = this.database
        .prepare("SELECT body FROM messages WHERE id = ?")
        .get(input.messageId) as { body: string } | undefined;

      return {
        body: currentBody?.body ?? "",
        html: null
      };
    }

    if (!remoteMessage.remoteUid || !remoteMessage.remoteFolderName) {
      throw new Error("This message does not have a remote IMAP body to fetch.");
    }

    const account = this.getAccountPassword(remoteMessage.accountId);

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
      const contentMode: MessageContentMode = fetchedContent.html ? "html-blocked" : "plain";

      this.database
        .prepare("UPDATE messages SET body = ?, content_mode = ? WHERE id = ?")
        .run(fetchedContent.body, contentMode, input.messageId);

      this.addLedgerEntry(
        "Message body fetched from IMAP",
        `${account.address} loaded the full RFC822 body for message ${input.messageId}.`,
        "info"
      );

      return fetchedContent;
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
      throw new Error("Unknown message.");
    }

    if (remoteMessage.accountId !== input.accountId) {
      throw new Error("Message does not belong to the requested account.");
    }

    if (!remoteMessage.remoteUid || !remoteMessage.remoteFolderName) {
      this.removeLocalMessage(input.messageId, input.accountId);
      return this.getWorkspaceSnapshot(context);
    }

    const account = this.getAccountPassword(input.accountId);

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
      throw new Error("Unknown message.");
    }

    if (remoteMessage.accountId !== input.accountId) {
      throw new Error("Message does not belong to the requested account.");
    }

    if (remoteMessage.remoteUid && remoteMessage.remoteFolderName) {
      const account = this.getAccountPassword(input.accountId);

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

  close() {
    this.database.close();
  }
}
