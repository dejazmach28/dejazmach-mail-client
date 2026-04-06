import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CreateAccountInput,
  CreateDraftInput,
  MessageContentMode,
  RuntimeEnvironment,
  WorkspaceSnapshot
} from "../shared/contracts.js";
import { sendPlainTextMessage, verifyAccountConnection } from "./providerClient.js";

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
  created_at: string;
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
    this.seedIfEmpty();
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
        outgoing_server TEXT NOT NULL,
        outgoing_port INTEGER NOT NULL,
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
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
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
  }

  private ensureReferenceData() {
    const insertFolder = this.database.prepare(
      "INSERT OR IGNORE INTO folders (id, name, kind, sort_order) VALUES (?, ?, ?, ?)"
    );

    [
      ["folder-priority", "Priority inbox", "priority", 1],
      ["folder-inbox", "Inbox", "inbox", 2],
      ["folder-security", "Security review", "security", 3],
      ["folder-drafts", "Shielded drafts", "drafts", 4],
      ["folder-sent", "Sent", "sent", 5],
      ["folder-archive", "Archive", "archive", 6]
    ].forEach((folder) => insertFolder.run(...folder));
  }

  private seedIfEmpty() {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM accounts").get() as { count: number };
    if (row.count > 0) {
      return;
    }

    const createdAt = nowIso();

    const insertAccount = this.database.prepare(`
      INSERT INTO accounts (
        id, name, address, provider, status, last_sync, unread_count, storage, username,
        incoming_server, incoming_port, outgoing_server, outgoing_port, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSecret = this.database.prepare(
      "INSERT INTO account_secrets (account_id, encrypted_secret, created_at) VALUES (?, ?, ?)"
    );

    const initialAccounts = [
      {
        id: "acc-ops",
        name: "Operations",
        address: "ops@dejazmach.app",
        provider: "Private IMAP",
        status: "online",
        lastSync: "10 seconds ago",
        unreadCount: 2,
        username: "ops@dejazmach.app",
        incomingServer: "imap.dejazmach.app",
        incomingPort: 993,
        outgoingServer: "smtp.dejazmach.app",
        outgoingPort: 465,
        secret: "seed-ops-password"
      },
      {
        id: "acc-leadership",
        name: "Leadership",
        address: "council@dejazmach.app",
        provider: "Hosted Exchange",
        status: "syncing",
        lastSync: "Sync in progress",
        unreadCount: 1,
        username: "council@dejazmach.app",
        incomingServer: "outlook.office365.com",
        incomingPort: 993,
        outgoingServer: "smtp.office365.com",
        outgoingPort: 587,
        secret: "seed-council-password"
      },
      {
        id: "acc-audit",
        name: "Audit",
        address: "ledger@dejazmach.app",
        provider: "Readonly archive",
        status: "attention",
        lastSync: "1 hour ago",
        unreadCount: 1,
        username: "ledger@dejazmach.app",
        incomingServer: "archive.dejazmach.app",
        incomingPort: 993,
        outgoingServer: "smtp.dejazmach.app",
        outgoingPort: 465,
        secret: "seed-audit-password"
      }
    ];

    for (const account of initialAccounts) {
      const storage = this.input.cipher.isAvailable() ? "OS vault" : "Metadata only";
      insertAccount.run(
        account.id,
        account.name,
        account.address,
        account.provider,
        account.status,
        account.lastSync,
        account.unreadCount,
        storage,
        account.username,
        account.incomingServer,
        account.incomingPort,
        account.outgoingServer,
        account.outgoingPort,
        createdAt
      );

      if (this.input.cipher.isAvailable()) {
        insertSecret.run(
          account.id,
          this.input.cipher.encryptString(JSON.stringify({ password: account.secret })),
          createdAt
        );
      }
    }

    const insertThread = this.database.prepare(
      "INSERT INTO threads (id, subject, classification, participants_json, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const insertMessage = this.database.prepare(`
      INSERT INTO messages (
        id, thread_id, account_id, folder_id, sender, address, subject, preview, label, time,
        unread, trust, sent_at, body, verified, content_mode, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const seededThreads = [
      {
        threadId: "thread-rotation",
        accountId: "acc-ops",
        folderId: "folder-priority",
        subject: "Root key rotation completed",
        classification: "Security-critical",
        participants: ["Infrastructure", "ops@dejazmach.app", "security@dejazmach.app"],
        sender: "Infrastructure",
        address: "security@dejazmach.app",
        label: "Security",
        trust: "encrypted" as const,
        unread: 1,
        verified: 1,
        contentMode: "plain" as const,
        body: `Morning team,

The key rotation finished cleanly across desktop profiles. DejAzmach kept remote content disabled during sync, attachment policy stayed locked, and no background trackers were contacted.

Next implementation step:
- wire real provider sync behind the local vault
- keep credentials out of renderer state
- preserve legible trust indicators in the desktop UI`,
        sentAt: "Today, 08:10",
        time: "08:10"
      },
      {
        threadId: "thread-launch",
        accountId: "acc-leadership",
        folderId: "folder-priority",
        subject: "Launch review approved for desktop shell",
        classification: "Product",
        participants: ["Design Council", "council@dejazmach.app"],
        sender: "Design Council",
        address: "council@dejazmach.app",
        label: "Product",
        trust: "trusted" as const,
        unread: 0,
        verified: 1,
        contentMode: "plain" as const,
        body: `The desktop direction is approved.

What worked:
- the interface feels like a native control room instead of a browser tab
- account state, sync state, and audit events sit in the main workflow
- the shell now persists data locally instead of inventing a fresh mock state every boot`,
        sentAt: "Today, 07:42",
        time: "07:42"
      },
      {
        threadId: "thread-audit",
        accountId: "acc-audit",
        folderId: "folder-security",
        subject: "Attachment sandbox report",
        classification: "Audit",
        participants: ["Ops Ledger", "ledger@dejazmach.app"],
        sender: "Ops Ledger",
        address: "ledger@dejazmach.app",
        label: "Audit",
        trust: "review" as const,
        unread: 1,
        verified: 1,
        contentMode: "html-blocked" as const,
        body: `HTML body blocked by policy.

Plain-text extraction:
- 2 files opened outside the app
- 0 inline executions
- 0 automatic previews from remote hosts
- 1 reminder generated for stricter file-type labeling`,
        sentAt: "Today, 06:30",
        time: "06:30"
      }
    ];

    for (const item of seededThreads) {
      insertThread.run(
        item.threadId,
        item.subject,
        item.classification,
        JSON.stringify(item.participants),
        createdAt
      );

      insertMessage.run(
        makeId("message"),
        item.threadId,
        item.accountId,
        item.folderId,
        item.sender,
        item.address,
        item.subject,
        textPreview(item.body),
        item.label,
        item.time,
        item.unread,
        item.trust,
        item.sentAt,
        item.body,
        item.verified,
        item.contentMode,
        createdAt
      );
    }

    const insertSyncJob = this.database.prepare(
      "INSERT INTO sync_jobs (id, title, detail, status, time, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    [
      ["sync-1", "Leadership mailbox delta sync", "Checking headers while local state remains the source of truth.", "running", "Now"],
      ["sync-2", "Audit archive compaction", "Preparing encrypted local storage boundaries for immutable audit mail.", "queued", "Next"],
      ["sync-3", "Local draft integrity check", "Verifying persisted drafts and account-vault records.", "complete", "07:54"]
    ].forEach((job) => insertSyncJob.run(...job, createdAt));

    const insertLedger = this.database.prepare(
      "INSERT INTO ledger_entries (id, title, detail, occurred_at, severity, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    [
      ["ledger-1", "Remote content stayed blocked", "No message view requested third-party images or scripts in this session.", "08:14", "info"],
      ["ledger-2", "Account secrets moved to local vault", `Account credentials are stored through ${this.input.cipher.isAvailable() ? "safeStorage-backed encryption" : "metadata-only mode because vault encryption is unavailable"}.`, "08:17", this.input.cipher.isAvailable() ? "info" : "notice"],
      ["ledger-3", "Unexpected downloads are blocked", "The shell prevents unmanaged downloads until an explicit attachment pipeline is implemented.", "08:22", "notice"]
    ].forEach((entry) => insertLedger.run(...entry, createdAt));
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
          folders.name,
          COUNT(messages.id) AS count,
          folders.kind
        FROM folders
        LEFT JOIN messages ON messages.folder_id = folders.id
        GROUP BY folders.id, folders.name, folders.kind, folders.sort_order
        ORDER BY folders.sort_order ASC
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
          accounts.outgoing_server AS outgoingServer,
          accounts.outgoing_port AS outgoingPort,
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
          outgoingServer: string;
          outgoingPort: number;
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

  createAccount(input: CreateAccountInput, context: WorkspaceContext): WorkspaceSnapshot {
    const accountId = makeId("account");
    const createdAt = nowIso();
    const storage = this.input.cipher.isAvailable() ? "OS vault" : "Metadata only";

    this.database
      .prepare(`
        INSERT INTO accounts (
          id, name, address, provider, status, last_sync, unread_count, storage, username,
          incoming_server, incoming_port, outgoing_server, outgoing_port, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        input.outgoingServer,
        input.outgoingPort,
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

    const threadId = makeId("thread");
    const welcomeBody = `Account ${input.address} was added locally.

Provider: ${input.provider}
Incoming: ${input.incomingServer}:${input.incomingPort}
Outgoing: ${input.outgoingServer}:${input.outgoingPort}

Credentials are ${this.input.cipher.isAvailable() ? "encrypted and persisted in the local vault." : "not yet protected by the OS vault in this environment."}`;

    this.database
      .prepare("INSERT INTO threads (id, subject, classification, participants_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(threadId, `Account onboarded for ${input.address}`, "Account", JSON.stringify([input.address]), createdAt);

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
        accountId,
        "folder-inbox",
        "DejAzmach Setup",
        input.address,
        `Account onboarded for ${input.address}`,
        textPreview(welcomeBody),
        "Setup",
        displayTime(),
        1,
        "trusted",
        `Today, ${displayTime()}`,
        welcomeBody,
        1,
        "plain",
        createdAt
      );

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
        "folder-drafts",
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
        outgoingServer: account.outgoingServer,
        outgoingPort: account.outgoingPort
      });

      this.database
        .prepare("UPDATE accounts SET status = ?, last_sync = ?, unread_count = ? WHERE id = ?")
        .run("online", `Verified ${displayTime()}`, Number(summary.imap.unseen ?? 0), accountId);

      const verificationBody = `Provider verification completed for ${account.address}.

IMAP:
- Greeting: ${summary.imap.greeting}
- Messages: ${summary.imap.messages ?? "unknown"}
- Unseen: ${summary.imap.unseen ?? "unknown"}

SMTP:
- Transport secured: ${summary.smtp.secured ? "yes" : "no"}
- Auth method: ${summary.smtp.authMethod}`;

      const threadId = makeId("thread");
      const createdAt = nowIso();

      this.database
        .prepare("INSERT INTO threads (id, subject, classification, participants_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(threadId, `Connectivity verified for ${account.address}`, "Connectivity", JSON.stringify([account.address]), createdAt);

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
          accountId,
          "folder-security",
          "DejAzmach Verification",
          account.address,
          `Connectivity verified for ${account.address}`,
          textPreview(verificationBody),
          "Connectivity",
          displayTime(),
          1,
          "trusted",
          `Today, ${displayTime()}`,
          verificationBody,
          1,
          "plain",
          createdAt
        );

      this.addLedgerEntry(
        "Provider verification succeeded",
        `${account.address} passed IMAP and SMTP verification. Inbox unseen count is ${summary.imap.unseen ?? "unknown"}.`,
        "info"
      );
      this.addSyncJob(`Connectivity verification for ${account.address}`, "IMAP and SMTP verification completed.", "complete");

      return this.getWorkspaceSnapshot(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown provider verification failure.";
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

    if (!input.to.trim()) {
      throw new Error("Recipient address is required before sending.");
    }

    await sendPlainTextMessage({
      username: account.username,
      password: account.password,
      fromAddress: account.address,
      fromName: account.name,
      outgoingServer: account.outgoingServer,
      outgoingPort: account.outgoingPort,
      to: input.to.trim(),
      subject,
      body
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
        "folder-sent",
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
  }

  close() {
    this.database.close();
  }
}
