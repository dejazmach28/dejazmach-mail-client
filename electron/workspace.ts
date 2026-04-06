import type { WorkspaceSnapshot } from "../shared/contracts.js";

type CreateWorkspaceSnapshotInput = {
  version: string;
  platform: string;
};

export const createWorkspaceSnapshot = ({
  version,
  platform
}: CreateWorkspaceSnapshotInput): WorkspaceSnapshot => ({
  shellState: {
    appName: "DejAzmach",
    version,
    platform,
    secureDesktopMode: true,
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
        detail: "External images, trackers, and unaudited embeds stay off until a user makes a visible choice."
      },
      {
        label: "Credential storage",
        value: "OS vault design",
        status: "monitoring",
        detail: "The next implementation layer should store secrets in the operating system credential vault, not renderer state."
      },
      {
        label: "Permission policy",
        value: "Denied unless implemented",
        status: "active",
        detail: "Camera, microphone, notifications, and other session permissions are denied in the shell today."
      }
    ],
    transparencyLedger: [
      {
        id: "ledger-1",
        title: "Remote content stayed blocked",
        detail: "No message view requested third-party images or scripts in this demo session.",
        occurredAt: "08:14",
        severity: "info"
      },
      {
        id: "ledger-2",
        title: "Account vault not yet connected",
        detail: "This build uses descriptive account metadata only. Live credential storage is intentionally not mocked as implemented.",
        occurredAt: "08:17",
        severity: "notice"
      },
      {
        id: "ledger-3",
        title: "External links require browser handoff",
        detail: "In-app windows are denied. Safe links should leave the desktop shell explicitly.",
        occurredAt: "08:19",
        severity: "info"
      }
    ]
  },
  accounts: [
    {
      id: "acc-ops",
      name: "Operations",
      address: "ops@dejazmach.app",
      provider: "Private IMAP",
      status: "online",
      lastSync: "10 seconds ago",
      unreadCount: 4,
      storage: "Vault planned"
    },
    {
      id: "acc-leadership",
      name: "Leadership",
      address: "council@dejazmach.app",
      provider: "Hosted Exchange",
      status: "syncing",
      lastSync: "Sync in progress",
      unreadCount: 2,
      storage: "Vault planned"
    },
    {
      id: "acc-audit",
      name: "Audit",
      address: "ledger@dejazmach.app",
      provider: "Readonly archive",
      status: "attention",
      lastSync: "1 hour ago",
      unreadCount: 1,
      storage: "Cold cache"
    }
  ],
  folders: [
    { id: "folder-priority", name: "Priority inbox", count: 4, kind: "priority" },
    { id: "folder-inbox", name: "Inbox", count: 9, kind: "inbox" },
    { id: "folder-security", name: "Security review", count: 3, kind: "security" },
    { id: "folder-drafts", name: "Shielded drafts", count: 6, kind: "drafts" },
    { id: "folder-archive", name: "Archive", count: 42, kind: "archive" }
  ],
  messages: [
    {
      id: "mail-rotation",
      threadId: "thread-rotation",
      accountId: "acc-ops",
      folderId: "folder-priority",
      sender: "Infrastructure",
      subject: "Root key rotation completed",
      preview: "All device sessions remained intact, remote content stayed blocked, and the audit marker has been written.",
      label: "Security",
      time: "08:10",
      unread: true,
      trust: "encrypted"
    },
    {
      id: "mail-launch",
      threadId: "thread-launch",
      accountId: "acc-leadership",
      folderId: "folder-priority",
      sender: "Design Council",
      subject: "Launch review approved for desktop shell",
      preview: "The latest pass keeps security evidence readable without turning the interface into an admin console.",
      label: "Product",
      time: "07:42",
      trust: "trusted"
    },
    {
      id: "mail-audit",
      threadId: "thread-audit",
      accountId: "acc-audit",
      folderId: "folder-security",
      sender: "Ops Ledger",
      subject: "Attachment sandbox report",
      preview: "Two files were opened outside the app after explicit confirmation. No automatic execution path was observed.",
      label: "Audit",
      time: "06:30",
      unread: true,
      trust: "review"
    },
    {
      id: "mail-drafts",
      threadId: "thread-drafts",
      accountId: "acc-ops",
      folderId: "folder-drafts",
      sender: "Field Office",
      subject: "Offline draft queued for sync",
      preview: "Draft remains local until the network policy clears. Nothing has been sent from this device yet.",
      label: "Draft",
      time: "05:58",
      trust: "trusted"
    }
  ],
  threads: [
    {
      id: "thread-rotation",
      subject: "Root key rotation completed",
      classification: "Security-critical",
      participants: ["Infrastructure", "ops@dejazmach.app", "security@dejazmach.app"],
      messages: [
        {
          id: "rotation-message-1",
          sender: "Infrastructure",
          address: "security@dejazmach.app",
          sentAt: "Today, 08:10",
          verified: true,
          body: `Morning team,

The key rotation finished cleanly across desktop profiles. DejAzmach kept remote content disabled during sync, attachment policy stayed locked, and no background trackers were contacted.

Next implementation step:
- wire IMAP and SMTP through a hardened main-process mail service
- move credentials into the operating system keychain
- sanitize HTML message rendering before any remote opt-in

Trust should remain visible in the product surface instead of being hidden in a settings page.`
        }
      ]
    },
    {
      id: "thread-launch",
      subject: "Launch review approved for desktop shell",
      classification: "Product",
      participants: ["Design Council", "council@dejazmach.app"],
      messages: [
        {
          id: "launch-message-1",
          sender: "Design Council",
          address: "council@dejazmach.app",
          sentAt: "Today, 07:42",
          verified: true,
          body: `The desktop direction is approved.

What worked:
- the interface feels like a native control room instead of a browser tab
- the trust model is readable without opening docs
- account state, sync state, and audit events sit in the main workflow

Keep the next phase equally strict on boundary design when real protocols are added.`
        }
      ]
    },
    {
      id: "thread-audit",
      subject: "Attachment sandbox report",
      classification: "Audit",
      participants: ["Ops Ledger", "ledger@dejazmach.app"],
      messages: [
        {
          id: "audit-message-1",
          sender: "Ops Ledger",
          address: "ledger@dejazmach.app",
          sentAt: "Today, 06:30",
          verified: true,
          body: `Attachment handling summary:

- 2 files opened outside the app
- 0 inline executions
- 0 automatic previews from remote hosts
- 1 reminder generated for stricter file-type labeling

Current shell behavior matches the declared transparency posture.`
        }
      ]
    },
    {
      id: "thread-drafts",
      subject: "Offline draft queued for sync",
      classification: "Workflow",
      participants: ["Field Office", "ops@dejazmach.app"],
      messages: [
        {
          id: "drafts-message-1",
          sender: "Field Office",
          address: "field@dejazmach.app",
          sentAt: "Today, 05:58",
          verified: false,
          body: `Draft saved locally.

This message is waiting for a future sync engine and encrypted local cache implementation. It exists here to prove the desktop layout can represent pending work without claiming network behavior that has not been built yet.`
        }
      ]
    }
  ],
  syncJobs: [
    {
      id: "sync-1",
      title: "Leadership mailbox delta sync",
      detail: "Checking headers only while the message body cache remains local-first.",
      status: "running",
      time: "Now"
    },
    {
      id: "sync-2",
      title: "Audit archive compaction",
      detail: "Preparing encrypted local storage boundaries for immutable audit mail.",
      status: "queued",
      time: "Next"
    },
    {
      id: "sync-3",
      title: "Attachment evidence digest",
      detail: "Last completed policy digest for explicit open-outside-app events.",
      status: "complete",
      time: "07:54"
    }
  ]
});
