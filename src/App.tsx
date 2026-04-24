import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type {
  ActionResult,
  CreateAccountInput,
  CreateDraftInput,
  FetchMessageBodyResult,
  SendMessageInput,
  WorkspaceSnapshot
} from "../shared/contracts.js";
import { ComposePanel } from "./components/ComposePanel.js";
import { MessageList } from "./components/MessageList.js";
import { MessageReader } from "./components/MessageReader.js";
import { OnboardingForm } from "./components/OnboardingForm.js";
import { ReauthModal } from "./components/ReauthModal.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { Sidebar } from "./components/Sidebar.js";

const initialAccountForm: CreateAccountInput = {
  name: "",
  address: "",
  provider: "IMAP",
  username: "",
  password: "",
  incomingServer: "",
  incomingPort: 993,
  incomingSecurity: "ssl_tls",
  outgoingServer: "",
  outgoingPort: 465,
  outgoingSecurity: "ssl_tls",
  outgoingAuthMethod: "auto"
};

const createEmptyDraftForm = (accountId = ""): CreateDraftInput => ({
  accountId,
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
  htmlBody: "",
  attachments: [],
  replyToMessageId: undefined
});

const emptyWorkspace: WorkspaceSnapshot = {
  shellState: {
    appName: "DejAzmach",
    version: "local",
    platform: "browser",
    environment: "development",
    packaged: false,
    secureDesktopMode: true,
    releaseTargets: [],
    capabilities: [],
    securityMetrics: [
      {
        label: "Desktop bridge",
        value: "Required",
        status: "monitoring",
        detail: "Account actions only work when the Electron preload bridge is active."
      },
      {
        label: "Credential storage",
        value: "Main process only",
        status: "monitoring",
        detail: "Secrets are kept outside the renderer and only handled by the desktop shell."
      }
    ],
    transparencyLedger: [
      {
        id: "local-1",
        title: "Workspace initialized",
        detail: "No mailbox content is rendered until a real desktop workspace is loaded.",
        occurredAt: "Local",
        severity: "notice"
      }
    ]
  },
  accounts: [],
  folders: [],
  messages: [],
  threads: [],
  syncJobs: []
};

const getAccountFolders = (workspace: WorkspaceSnapshot, accountId: string) =>
  workspace.folders.filter((folder) => folder.accountId === accountId);

const getFirstFolderId = (workspace: WorkspaceSnapshot, accountId: string) => {
  if (!accountId) {
    return "";
  }

  const folders = getAccountFolders(workspace, accountId);
  return folders.find((folder) => folder.kind === "inbox")?.id ?? folders[0]?.id ?? "";
};

const getFolderIdForAccount = (
  workspace: WorkspaceSnapshot,
  accountId: string,
  kind: "inbox" | "drafts" | "sent" | "archive" | "security"
) => {
  if (!accountId) {
    return "";
  }

  const folders = getAccountFolders(workspace, accountId);
  return folders.find((folder) => folder.kind === kind)?.id ?? getFirstFolderId(workspace, accountId);
};

const getFirstThreadId = (workspace: WorkspaceSnapshot, accountId: string, folderId: string) => {
  if (!accountId || !folderId) {
    return "";
  }

  return (
    workspace.messages.find((message) => message.accountId === accountId && message.folderId === folderId)?.threadId ??
    ""
  );
};

const unwrapResult = <T,>(result: ActionResult<T>) => {
  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.data;
};

const withSubjectPrefix = (subject: string, prefix: "Re" | "Fwd") => {
  const trimmedSubject = subject.trim() || "No subject";
  const prefixPattern = new RegExp(`^${prefix}:\\s*`, "i");
  return prefixPattern.test(trimmedSubject) ? trimmedSubject : `${prefix}: ${trimmedSubject}`;
};

const quoteBody = (body: string) =>
  body
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

const buildQuotedReplyBody = (sentAt: string, sender: string, body: string) =>
  `\n\n> On ${sentAt}, ${sender} wrote:\n${quoteBody(body)}`;

const splitAddresses = (value?: string) =>
  (value ?? "")
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const mergeUniqueAddresses = (...groups: Array<string[]>) => {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const group of groups) {
    for (const entry of group) {
      const key = entry.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(entry);
      }
    }
  }

  return merged;
};

const readStoredPaneWidth = (storageKey: string, fallback: number) => {
  if (typeof window === "undefined") {
    return fallback;
  }

  const rawValue = window.localStorage.getItem(storageKey);
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
};

const applyFetchedMessageBody = (
  workspace: WorkspaceSnapshot,
  messageId: string,
  fetchedMessage: FetchMessageBodyResult
): WorkspaceSnapshot => ({
  ...workspace,
  threads: workspace.threads.map((thread) => ({
    ...thread,
    messages: thread.messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            body: fetchedMessage.body,
            html: fetchedMessage.html,
            attachments: fetchedMessage.attachments,
            to: fetchedMessage.to ?? message.to,
            cc: fetchedMessage.cc ?? message.cc,
            contentMode: "plain"
          }
        : message
    )
  }))
});

type NoticeTone = "warning" | "critical" | "success";

const NoticeBanner = ({
  message,
  tone,
  onDismiss
}: {
  message: string;
  tone: NoticeTone;
  onDismiss: () => void;
}) => (
  <p
    className={[
      "inline-notice",
      tone === "critical" ? "inline-notice-critical" : "",
      tone === "success" ? "inline-notice-success" : ""
    ]
      .filter(Boolean)
      .join(" ")}
  >
    {message}
    <button aria-label="Dismiss notification" className="toast-dismiss" onClick={onDismiss} type="button">
      ×
    </button>
  </p>
);

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(emptyWorkspace);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [activeSurface, setActiveSurface] = useState<"message" | "compose" | "settings">("message");
  const [searchQuery, setSearchQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionNoticeDuration, setActionNoticeDuration] = useState(5000);
  const [isBooting, setIsBooting] = useState(Boolean(window.desktopApi));
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [loadingMessageBodyId, setLoadingMessageBodyId] = useState<string | null>(null);
  const [verifyingAccountId, setVerifyingAccountId] = useState<string | null>(null);
  const [showAccountSetup, setShowAccountSetup] = useState(false);
  const [reauthAccountId, setReauthAccountId] = useState<string | null>(null);
  const [reauthPassword, setReauthPassword] = useState("");
  const [isReauthenticating, setIsReauthenticating] = useState(false);
  const [dismissedReauthIds, setDismissedReauthIds] = useState<string[]>([]);
  const [folderSyncTimestamps, setFolderSyncTimestamps] = useState<Record<string, number>>({});
  const [autoSyncingFolderKey, setAutoSyncingFolderKey] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"sidebar" | "list" | "reader">("list");
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredPaneWidth("dejazmach.sidebar-width", 240));
  const [listWidth, setListWidth] = useState(() => readStoredPaneWidth("dejazmach.list-width", 340));
  const [draggingPane, setDraggingPane] = useState<"sidebar" | "list" | null>(null);
  const [accountForm, setAccountForm] = useState<CreateAccountInput>(initialAccountForm);
  const [draftForm, setDraftForm] = useState<CreateDraftInput>({
    ...createEmptyDraftForm("")
  });

  // Refs to always have the latest selection IDs when applyWorkspace is called inside async callbacks.
  const selectedAccountIdRef = useRef(selectedAccountId);
  const selectedFolderIdRef = useRef(selectedFolderId);
  const selectedThreadIdRef = useRef(selectedThreadId);
  useEffect(() => { selectedAccountIdRef.current = selectedAccountId; }, [selectedAccountId]);
  useEffect(() => { selectedFolderIdRef.current = selectedFolderId; }, [selectedFolderId]);
  useEffect(() => { selectedThreadIdRef.current = selectedThreadId; }, [selectedThreadId]);

  const applyWorkspace = (nextWorkspace: WorkspaceSnapshot) => {
    const currentAccountId = selectedAccountIdRef.current;
    const currentFolderId = selectedFolderIdRef.current;
    const currentThreadId = selectedThreadIdRef.current;

    const nextAccountId = nextWorkspace.accounts.some((account) => account.id === currentAccountId)
      ? currentAccountId
      : (nextWorkspace.accounts[0]?.id ?? "");
    const nextFolderId = nextWorkspace.folders.some((folder) => folder.id === currentFolderId)
      ? currentFolderId
      : getFirstFolderId(nextWorkspace, nextAccountId);
    const nextThreadId = nextWorkspace.threads.some((thread) => thread.id === currentThreadId)
      ? currentThreadId
      : "";

    setWorkspace(nextWorkspace);
    setSelectedAccountId(nextAccountId);
    setSelectedFolderId(nextFolderId);
    setSelectedThreadId(nextThreadId);
    setDraftForm((currentDraft) => ({
      ...currentDraft,
      accountId:
        nextWorkspace.accounts.some((account) => account.id === currentDraft.accountId)
          ? currentDraft.accountId
          : (nextWorkspace.accounts[0]?.id ?? "")
    }));
    // Reset the onboarding form when the last account is removed so the
    // welcome screen always starts with a blank form.
    if (nextWorkspace.accounts.length === 0) {
      setAccountForm(initialAccountForm);
    }
  };

  useEffect(() => {
    if (!window.desktopApi) {
      setLoadError("Desktop bridge unavailable. Launch the packaged Electron app instead of a browser preview.");
      setIsBooting(false);
      return;
    }

    void window.desktopApi
      .getWorkspaceSnapshot()
      .then((nextWorkspace) => {
        applyWorkspace(nextWorkspace);
      })
      .catch(() => {
        setLoadError("Desktop data could not be loaded.");
      })
      .finally(() => {
        setIsBooting(false);
      });
  }, []);

  useEffect(() => {
    if (!window.desktopApi) {
      return;
    }

    return window.desktopApi.onWorkspaceUpdate((snapshot) => {
      applyWorkspace(snapshot);
    });
  }, []);

  useEffect(() => {
    window.localStorage.setItem("dejazmach.sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem("dejazmach.list-width", String(listWidth));
  }, [listWidth]);

  useEffect(() => {
    if (!draggingPane) {
      return;
    }

    const handlePointerMove = (event: MouseEvent) => {
      if (window.innerWidth < 1024) {
        return;
      }

      const edgePadding = 360;

      if (draggingPane === "sidebar") {
        const nextSidebarWidth = Math.min(
          420,
          Math.max(190, event.clientX)
        );
        const maxSidebarWidth = Math.max(190, window.innerWidth - listWidth - edgePadding);
        setSidebarWidth(Math.min(nextSidebarWidth, maxSidebarWidth));
        return;
      }

      const nextListWidth = Math.min(
        620,
        Math.max(280, event.clientX - sidebarWidth - 10)
      );
      const maxListWidth = Math.max(280, window.innerWidth - sidebarWidth - edgePadding);
      setListWidth(Math.min(nextListWidth, maxListWidth));
    };

    const stopDragging = () => {
      setDraggingPane(null);
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", stopDragging);

    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", stopDragging);
    };
  }, [draggingPane, listWidth, sidebarWidth]);

  useEffect(() => {
    const pendingAccount = workspace.accounts.find(
      (account) => account.needsReauth && !dismissedReauthIds.includes(account.id)
    );

    if (pendingAccount && reauthAccountId !== pendingAccount.id) {
      setReauthAccountId(pendingAccount.id);
      setReauthPassword("");
    }
  }, [dismissedReauthIds, reauthAccountId, workspace.accounts]);

  useEffect(() => {
    if (!loadError) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setLoadError(null);
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadError]);

  useEffect(() => {
    if (!actionError) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setActionError(null);
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [actionError]);

  useEffect(() => {
    if (!actionNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setActionNotice(null);
    }, actionNoticeDuration);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [actionNotice, actionNoticeDuration]);

  const showActionNotice = (message: string, duration = 5000) => {
    setActionNoticeDuration(duration);
    setActionNotice(message);
  };

  const hasAccounts = workspace.accounts.length > 0;
  const selectedAccount =
    workspace.accounts.find((account) => account.id === selectedAccountId) ?? workspace.accounts[0];
  const visibleFolders = selectedAccount ? getAccountFolders(workspace, selectedAccount.id) : [];
  const selectedFolder = visibleFolders.find((folder) => folder.id === selectedFolderId) ?? visibleFolders[0];
  const selectedFolderKey = selectedAccount && selectedFolder ? `${selectedAccount.id}:${selectedFolder.id}` : null;
  const accountMessages = useMemo(
    () => (selectedAccount ? workspace.messages.filter((message) => message.accountId === selectedAccount.id) : []),
    [selectedAccount, workspace.messages]
  );
  const search = searchQuery.trim().toLowerCase();
  const folderMessages = useMemo(
    () => (selectedAccount ? accountMessages.filter((message) => message.folderId === selectedFolder?.id) : []),
    [selectedAccount, accountMessages, selectedFolder?.id]
  );
  const visibleMessages = useMemo(
    () =>
      !search
        ? folderMessages
        : accountMessages.filter((message) =>
            [message.sender, message.subject, message.preview, message.label].some((value) =>
              value.toLowerCase().includes(search)
            )
          ),
    [accountMessages, folderMessages, search]
  );
  const selectedThread = workspace.threads.find((thread) => thread.id === selectedThreadId);
  const readerMessage = visibleMessages.find((message) => message.threadId === selectedThread?.id);
  const activeThreadMessage = selectedThread?.messages[0];
  const reauthAccount = workspace.accounts.find((account) => account.id === reauthAccountId);

  useEffect(() => {
    if (!window.desktopApi || !selectedAccount?.id || !selectedFolder?.name || !selectedFolderKey) {
      return;
    }

    const lastSyncedAt = folderSyncTimestamps[selectedFolderKey] ?? 0;
    const neverSynced = lastSyncedAt === 0;

    // Always sync on first visit to a folder; otherwise throttle to 2 minutes.
    if (!neverSynced && Date.now() - lastSyncedAt < 2 * 60 * 1000) {
      return;
    }

    let cancelled = false;
    setAutoSyncingFolderKey(selectedFolderKey);

    void window.desktopApi
      .syncFolder({
        accountId: selectedAccount.id,
        folderName: selectedFolder.name
      })
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (result.data) {
          applyWorkspace(result.data);
        }

        unwrapResult(result);
        setFolderSyncTimestamps((current) => ({
          ...current,
          [selectedFolderKey]: Date.now()
        }));
      })
      .catch((error) => {
        if (!cancelled) {
          setActionError(error instanceof Error ? error.message : "Folder sync failed.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAutoSyncingFolderKey((current) => (current === selectedFolderKey ? null : current));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [folderSyncTimestamps, selectedAccount?.id, selectedFolder?.name, selectedFolderKey]);

  const updateAccountForm = <K extends keyof CreateAccountInput>(field: K, value: CreateAccountInput[K]) => {
    setAccountForm((current) => ({
      ...current,
      [field]: value
    }));
  };

  const updateDraftForm = <K extends keyof CreateDraftInput>(field: K, value: CreateDraftInput[K]) => {
    setDraftForm((current) => ({
      ...current,
      [field]: value
    }));
  };

  const resetDraftFields = () => {
    setDraftForm((currentDraft) => createEmptyDraftForm(currentDraft.accountId));
  };

  const chooseAccount = (accountId: string) => {
    const nextFolderId = getFirstFolderId(workspace, accountId);
    setSelectedAccountId(accountId);
    setSelectedFolderId(nextFolderId);
    setSelectedThreadId("");
    setActiveSurface("message");
    setMobilePanel("list");
  };

  const requestReauth = (accountId: string) => {
    setDismissedReauthIds((currentIds) => currentIds.filter((id) => id !== accountId));
    setReauthAccountId(accountId);
    setReauthPassword("");
  };

  const chooseFolder = (folderId: string) => {
    if (!selectedAccount) {
      return;
    }

    setSelectedFolderId(folderId);
    setSelectedThreadId("");
    setActiveSurface("message");
    setMobilePanel("list");
  };

  const openComposer = (
    accountId = selectedAccount?.id ?? workspace.accounts[0]?.id ?? "",
    overrides: Partial<CreateDraftInput> = {}
  ) => {
    setDraftForm({
      ...createEmptyDraftForm(accountId),
      ...overrides,
      accountId
    });
    setActiveSurface("compose");
    setMobilePanel("reader");
  };

  const discardDraft = () => {
    resetDraftFields();
    setActiveSurface("message");
    setMobilePanel("list");
  };

  const openMessage = async (messageId: string, threadId: string, accountId: string) => {
    setSelectedThreadId(threadId);
    setActiveSurface("message");
    setMobilePanel("reader");
    setActionError(null);

    const selectedMessage = workspace.messages.find((message) => message.id === messageId);
    const thread = workspace.threads.find((candidate) => candidate.id === threadId);
    const needsRemoteFetch = thread?.messages.some(
      (message) => message.id === messageId && message.contentMode === "remote-pending"
    );

    if (!window.desktopApi) {
      return;
    }

    try {
      if (needsRemoteFetch) {
        setLoadingMessageBodyId(messageId);
        const result = await window.desktopApi.fetchMessageBody({ accountId, messageId });
        if (result.data) {
          const fetchedMessage = result.data;
          setWorkspace((currentWorkspace) => applyFetchedMessageBody(currentWorkspace, messageId, fetchedMessage));
        }
        unwrapResult(result);
      }

      if (!selectedMessage?.unread) {
        return;
      }

      const readResult = await window.desktopApi.markRead({ accountId, messageId });
      if (readResult.data) {
        applyWorkspace(readResult.data);
      }
      unwrapResult(readResult);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Message body fetch failed.");
    } finally {
      setLoadingMessageBodyId(null);
    }
  };

  const handleDeleteMessage = async (accountId: string, messageId: string) => {
    if (!window.desktopApi) {
      setActionError("Deleting a message requires the Electron desktop shell.");
      return;
    }

    setActionError(null);
    setActionNotice(null);

    try {
      const result = await window.desktopApi.deleteMessage({ accountId, messageId });
      if (result.data) {
        applyWorkspace(result.data);
      }
      unwrapResult(result);
      showActionNotice("Message deleted.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Message delete failed.");
    }
  };

  const handleMoveMessage = async (accountId: string, messageId: string, targetFolderName: string) => {
    if (!window.desktopApi) {
      setActionError("Moving a message requires the Electron desktop shell.");
      return;
    }

    setActionError(null);
    setActionNotice(null);

    try {
      const result = await window.desktopApi.moveMessage({ accountId, messageId, targetFolderName });
      if (result.data) {
        applyWorkspace(result.data);
      }
      unwrapResult(result);
      showActionNotice(`Message moved to ${targetFolderName}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Message move failed.");
    }
  };

  const handleArchiveMessage = async (accountId: string, messageId: string) => {
    if (!window.desktopApi) {
      setActionError("Archiving a message requires the Electron desktop shell.");
      return;
    }

    setActionError(null);
    setActionNotice(null);

    try {
      const result = await window.desktopApi.archiveMessage({ accountId, messageId });
      if (result.data) {
        applyWorkspace(result.data);
      }
      unwrapResult(result);
      showActionNotice("Message archived.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Message archive failed.");
    }
  };

  const handleMarkUnread = async (accountId: string, messageId: string) => {
    if (!window.desktopApi) {
      setActionError("Marking unread requires the Electron desktop shell.");
      return;
    }

    try {
      const result = await window.desktopApi.markUnread({ accountId, messageId });
      if (result.data) {
        applyWorkspace(result.data);
      }
      unwrapResult(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Mark unread failed.");
    }
  };

  const handleToggleFlag = async (accountId: string, messageId: string, flagged: boolean) => {
    if (!window.desktopApi) {
      setActionError("Flagging a message requires the Electron desktop shell.");
      return;
    }

    try {
      const result = await window.desktopApi.toggleFlag({ accountId, messageId, flagged });
      if (result.data) {
        applyWorkspace(result.data);
      }
      unwrapResult(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Flag update failed.");
    }
  };

  const handleMarkSpam = async (accountId: string, messageId: string) => {
    if (!window.desktopApi) {
      setActionError("Spam actions require the Electron desktop shell.");
      return;
    }

    try {
      const result = await window.desktopApi.markSpam({ accountId, messageId });
      if (result.data) {
        applyWorkspace(result.data);
      }
      unwrapResult(result);
      showActionNotice("Message moved to spam.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Mark spam failed.");
    }
  };

  const runBatchMessageAction = async (
    messageIds: string[],
    executor: (accountId: string, messageId: string) => Promise<ActionResult<WorkspaceSnapshot>>,
    successMessage: string
  ) => {
    if (!window.desktopApi || !selectedAccount?.id || messageIds.length === 0) {
      return;
    }

    setActionError(null);
    setActionNotice(null);

    try {
      let nextWorkspace: WorkspaceSnapshot | null = null;
      for (const messageId of Array.from(new Set(messageIds))) {
        const result = await executor(selectedAccount.id, messageId);
        if (result.data) {
          nextWorkspace = result.data;
        }
        unwrapResult(result);
      }

      if (nextWorkspace) {
        applyWorkspace(nextWorkspace);
      }

      showActionNotice(successMessage);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Message action failed.");
    }
  };

  const handleAccountSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError(null);
    setActionNotice(null);

    if (!window.desktopApi) {
      setActionError("Account onboarding requires the Electron desktop shell.");
      return;
    }

    setIsSavingAccount(true);

    // Track the created account ID so we can roll back if verification fails.
    let createdAccountId: string | null = null;

    try {
      // Step 1: persist credentials locally.
      const createResult = await window.desktopApi.createAccount(accountForm);
      if (!createResult.ok || !createResult.data) {
        throw new Error(!createResult.ok ? createResult.error : "Failed to save account.");
      }
      const createdAccount = createResult.data.accounts[createResult.data.accounts.length - 1];
      if (!createdAccount) {
        throw new Error("Account record was not created.");
      }
      createdAccountId = createdAccount.id;

      // Step 2: connect to the server, discover folders, sync inbox.
      // If this throws we roll back the account so the user stays on the form.
      const verifyResult = await window.desktopApi.verifyAccount(createdAccount.id);
      if (!verifyResult.ok || !verifyResult.data) {
        throw new Error(!verifyResult.ok ? verifyResult.error : "Could not connect to the mail server. Check your credentials and server settings.");
      }
      const verifiedWorkspace = verifyResult.data;

      // Success — apply the fully-loaded workspace.
      const nextFolderId = getFolderIdForAccount(verifiedWorkspace, createdAccount.id, "inbox");
      applyWorkspace(verifiedWorkspace);
      setSelectedAccountId(createdAccount.id);
      setSelectedFolderId(nextFolderId);
      setSelectedThreadId(getFirstThreadId(verifiedWorkspace, createdAccount.id, nextFolderId));
      setDraftForm((currentDraft) => ({ ...currentDraft, accountId: createdAccount.id }));
      // Mark the inbox as freshly synced so the auto-sync doesn't immediately re-fire.
      const inboxFolder = verifiedWorkspace.folders.find(
        (f) => f.accountId === createdAccount.id && f.kind === "inbox"
      );
      if (inboxFolder) {
        const key = `${createdAccount.id}:${inboxFolder.id}`;
        setFolderSyncTimestamps((current) => ({ ...current, [key]: Date.now() }));
      }
      setAccountForm(initialAccountForm);
      setShowAccountSetup(false);
      setActiveSurface("message");
      createdAccountId = null; // no rollback needed

      const folderCount = verifiedWorkspace.folders.filter((f) => f.accountId === createdAccount.id).length;
      showActionNotice(`${accountForm.address} connected — ${folderCount} folder${folderCount === 1 ? "" : "s"} loaded.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Account setup failed.";
      setActionError(message);
      // Roll back: remove the account record so the user can try again from the form.
      if (createdAccountId && window.desktopApi) {
        void window.desktopApi.deleteAccount(createdAccountId).catch(() => {});
      }
    } finally {
      setIsSavingAccount(false);
    }
  };

  const handleDraftSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError(null);
    setActionNotice(null);

    if (!window.desktopApi) {
      setActionError("Draft persistence requires the Electron desktop shell.");
      return;
    }

    setIsSavingDraft(true);

    try {
      const nextWorkspace = unwrapResult(await window.desktopApi.createDraft(draftForm));
      const nextFolderId = getFolderIdForAccount(nextWorkspace, draftForm.accountId, "drafts");
      applyWorkspace(nextWorkspace);
      setSelectedAccountId(draftForm.accountId);
      setSelectedFolderId(nextFolderId);
      setSelectedThreadId(getFirstThreadId(nextWorkspace, draftForm.accountId, nextFolderId));
      resetDraftFields();
      setActiveSurface("message");
      showActionNotice("Draft saved.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Draft persistence failed.");
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleVerifyAccount = async (accountId: string) => {
    setActionError(null);
    setActionNotice(null);

    if (!window.desktopApi) {
      setActionError("Provider verification requires the Electron desktop shell.");
      return;
    }

    setVerifyingAccountId(accountId);

    try {
      const result = await window.desktopApi.verifyAccount(accountId);
      if (result.data) {
        applyWorkspace(result.data);
      }
      const nextWorkspace = unwrapResult(result);
      const nextFolderId = getFolderIdForAccount(nextWorkspace, accountId, "inbox");
      setSelectedAccountId(accountId);
      setSelectedFolderId(nextFolderId);
      setSelectedThreadId(getFirstThreadId(nextWorkspace, accountId, nextFolderId));
      setActiveSurface("message");
      showActionNotice("Account verification completed and server folders were refreshed.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Provider verification failed.");
    } finally {
      setVerifyingAccountId(null);
    }
  };

  const handleSendMessage = async () => {
    setActionError(null);
    setActionNotice(null);

    if (!window.desktopApi) {
      setActionError("Outbound delivery requires the Electron desktop shell.");
      return;
    }

    setIsSendingMessage(true);

    try {
      const sendInput: SendMessageInput = {
        ...draftForm,
        bcc: splitAddresses(draftForm.bcc)
      };
      const result = await window.desktopApi.sendMessage(sendInput);
      if (result.data) {
        applyWorkspace(result.data);
      }
      const nextWorkspace = unwrapResult(result);
      const nextFolderId = getFolderIdForAccount(nextWorkspace, draftForm.accountId, "sent");
      setSelectedAccountId(draftForm.accountId);
      setSelectedFolderId(nextFolderId);
      setSelectedThreadId(getFirstThreadId(nextWorkspace, draftForm.accountId, nextFolderId));
      resetDraftFields();
      setActiveSurface("message");
      showActionNotice("Message submitted through SMTP.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Message delivery failed.");
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleReauthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!window.desktopApi || !reauthAccountId) {
      setActionError("Re-authentication requires the Electron desktop shell.");
      return;
    }

    setIsReauthenticating(true);
    setActionError(null);

    try {
      const result = await window.desktopApi.reauthAccount({
        accountId: reauthAccountId,
        password: reauthPassword
      });
      if (result.data) {
        applyWorkspace(result.data);
      }
      unwrapResult(result);
      setDismissedReauthIds((currentIds) => currentIds.filter((id) => id !== reauthAccountId));
      setReauthAccountId(null);
      setReauthPassword("");
      showActionNotice("Password stored. Mailbox sync resumed.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Re-authentication failed.");
    } finally {
      setIsReauthenticating(false);
    }
  };

  return (
    <main className="app-shell">
      {isBooting ? (
        <div className="boot-overlay" aria-live="polite">
          <div className="boot-card">
            <span className="eyebrow">DejAzmach desktop shell</span>
            <h2>Preparing secure workspace</h2>
            <p>Loading the restricted Electron shell and local workspace services.</p>
          </div>
        </div>
      ) : null}

      {hasAccounts && showAccountSetup ? (
        <div className="modal-overlay">
          <OnboardingForm
            compact
            form={accountForm}
            isSavingAccount={isSavingAccount}
            onCancel={() => setShowAccountSetup(false)}
            onFieldChange={updateAccountForm}
            onSubmit={handleAccountSubmit}
            subtitle="Account setup"
            title="Add another mailbox"
          />
        </div>
      ) : null}

      {reauthAccount ? (
        <ReauthModal
          accountAddress={reauthAccount.address}
          isSubmitting={isReauthenticating}
          onCancel={() => {
            setDismissedReauthIds((currentIds) =>
              currentIds.includes(reauthAccount.id) ? currentIds : [...currentIds, reauthAccount.id]
            );
            setReauthAccountId(null);
            setReauthPassword("");
          }}
          onChangePassword={setReauthPassword}
          onSubmit={handleReauthSubmit}
          password={reauthPassword}
        />
      ) : null}

      {!hasAccounts ? (
        <section className="welcome-shell">
          <div className="welcome-backdrop welcome-backdrop-left" aria-hidden="true" />
          <div className="welcome-backdrop welcome-backdrop-right" aria-hidden="true" />

          <article className="welcome-copy">
            <span className="eyebrow">DejAzmach</span>
            <h1>Connect one mailbox, then the full desktop workspace appears.</h1>
            <p>
              No demo inbox. No fake folders. DejAzmach stays empty until a real account is configured
              and verified against the server.
            </p>

            <div className="welcome-points">
              <div className="welcome-point">
                <strong>Server-driven folders</strong>
                <p>IMAP folders are fetched from the host, so custom mailbox structures show up correctly.</p>
              </div>
              <div className="welcome-point">
                <strong>Three-pane workflow</strong>
                <p>After setup, the interface switches to account rail, message list, and reading pane.</p>
              </div>
              <div className="welcome-point">
                <strong>Main-process secrets</strong>
                <p>Credentials stay out of the renderer and message HTML remains blocked by default.</p>
              </div>
            </div>

            {loadError ? <NoticeBanner message={loadError} onDismiss={() => setLoadError(null)} tone="warning" /> : null}
            {actionError ? (
              <NoticeBanner message={actionError} onDismiss={() => setActionError(null)} tone="critical" />
            ) : null}
            {actionNotice ? (
              <NoticeBanner message={actionNotice} onDismiss={() => setActionNotice(null)} tone="success" />
            ) : null}
          </article>

          <div className="welcome-form">
            <OnboardingForm
              form={accountForm}
              isSavingAccount={isSavingAccount}
              onFieldChange={updateAccountForm}
              onSubmit={handleAccountSubmit}
              subtitle="Welcome"
              title="Configure your first account"
            />
          </div>
        </section>
      ) : (
        <>
          {loadError || actionError || actionNotice ? (
            <section className="notice-strip">
              {loadError ? <NoticeBanner message={loadError} onDismiss={() => setLoadError(null)} tone="warning" /> : null}
              {actionError ? (
                <NoticeBanner message={actionError} onDismiss={() => setActionError(null)} tone="critical" />
              ) : null}
              {actionNotice ? (
                <NoticeBanner message={actionNotice} onDismiss={() => setActionNotice(null)} tone="success" />
              ) : null}
            </section>
          ) : null}

          <section
            className="workspace-frame"
            data-mobile-panel={mobilePanel}
            style={
              {
                "--sidebar-width": `${sidebarWidth}px`,
                "--list-width": `${listWidth}px`
              } as CSSProperties
            }
          >
            {mobilePanel === "sidebar" ? (
              <div
                className="sidebar-scrim"
                aria-hidden="true"
                onClick={() => setMobilePanel("list")}
              />
            ) : null}
            <Sidebar
              accounts={workspace.accounts}
              appName={workspace.shellState.appName}
              folders={visibleFolders}
              onCompose={() => openComposer()}
              onCloseSidebar={() => setMobilePanel("list")}
              onSelectAccount={chooseAccount}
              onSelectFolder={chooseFolder}
              onRequestReauth={requestReauth}
              onShowAddAccount={() => setShowAccountSetup(true)}
              onShowSettings={() => { setActiveSurface("settings"); setMobilePanel("reader"); }}
              selectedAccountId={selectedAccount?.id ?? ""}
              selectedFolderId={selectedFolder?.id ?? ""}
            />
            <div
              aria-hidden="true"
              className={draggingPane === "sidebar" ? "pane-resizer pane-resizer-active" : "pane-resizer"}
              onMouseDown={() => setDraggingPane("sidebar")}
              role="presentation"
            />

            <MessageList
              accountId={selectedAccount?.id}
              folderName={search ? "Search results" : selectedFolder?.name ?? ""}
              isAutoSyncing={autoSyncingFolderKey === selectedFolderKey}
              isLoadingFolder={autoSyncingFolderKey === selectedFolderKey && folderMessages.length === 0}
              messages={visibleMessages}
              onArchiveSelection={(messageIds) =>
                runBatchMessageAction(
                  messageIds,
                  async (accountId, messageId) => window.desktopApi!.archiveMessage({ accountId, messageId }),
                  messageIds.length === 1 ? "Message archived." : `${messageIds.length} messages archived.`
                )
              }
              onDeleteSelection={(messageIds) =>
                runBatchMessageAction(
                  messageIds,
                  async (accountId, messageId) => window.desktopApi!.deleteMessage({ accountId, messageId }),
                  messageIds.length === 1 ? "Message deleted." : `${messageIds.length} messages deleted.`
                )
              }
              onMarkSpamSelection={(messageIds) =>
                runBatchMessageAction(
                  messageIds,
                  async (accountId, messageId) => window.desktopApi!.markSpam({ accountId, messageId }),
                  messageIds.length === 1 ? "Message moved to spam." : `${messageIds.length} messages moved to spam.`
                )
              }
              onMarkUnreadSelection={(messageIds) =>
                runBatchMessageAction(
                  messageIds,
                  async (accountId, messageId) => window.desktopApi!.markUnread({ accountId, messageId }),
                  messageIds.length === 1 ? "Message marked unread." : `${messageIds.length} messages marked unread.`
                )
              }
              onOpenMessage={openMessage}
              onShowSidebar={() => setMobilePanel("sidebar")}
              onSearchQueryChange={setSearchQuery}
              onSyncComplete={(nextWorkspace, syncedFolderName) => {
                applyWorkspace(nextWorkspace);
                if (selectedAccount?.id && selectedFolder?.name === syncedFolderName && selectedFolderKey) {
                  setFolderSyncTimestamps((current) => ({
                    ...current,
                    [selectedFolderKey]: Date.now()
                  }));
                }
              }}
              onSyncError={(message) => setActionError(message)}
              searchQuery={searchQuery}
              selectedFolderName={search ? "Search results" : selectedFolder?.name}
              selectedThreadId={selectedThread?.id ?? ""}
              unreadCount={selectedAccount?.unreadCount}
            />
            <div
              aria-hidden="true"
              className={draggingPane === "list" ? "pane-resizer pane-resizer-active" : "pane-resizer"}
              onMouseDown={() => setDraggingPane("list")}
              role="presentation"
            />

            <section className="reader-pane">
              {activeSurface === "compose" ? (
                <ComposePanel
                  accounts={workspace.accounts}
                  draftForm={draftForm}
                  isSavingDraft={isSavingDraft}
                  isSendingMessage={isSendingMessage}
                  onDiscard={discardDraft}
                  onFieldChange={updateDraftForm}
                  onSend={() => void handleSendMessage()}
                  onSubmit={handleDraftSubmit}
                />
              ) : activeSurface === "settings" ? (
                <SettingsPanel
                  environment={workspace.shellState.environment}
                  onError={(message) => setActionError(message)}
                  onNotice={showActionNotice}
                  onSignatureSaved={() => showActionNotice("Signature saved.", 2000)}
                  onVerifyAccount={(accountId) => {
                    void handleVerifyAccount(accountId);
                  }}
                  onWorkspaceChange={applyWorkspace}
                  platform={workspace.shellState.platform}
                  selectedAccount={selectedAccount}
                  version={workspace.shellState.version}
                  verifyingAccountId={verifyingAccountId}
                />
              ) : (
                <MessageReader
                  folders={visibleFolders.map((folder) => ({ id: folder.id, name: folder.name }))}
                  loadingMessageBodyId={loadingMessageBodyId}
                  onBack={() => setMobilePanel("list")}
                  onArchive={() => {
                    if (selectedAccount?.id && readerMessage?.id) {
                      void handleArchiveMessage(selectedAccount.id, readerMessage.id);
                    }
                  }}
                  onDelete={() => {
                    if (selectedAccount?.id && readerMessage?.id) {
                      void handleDeleteMessage(selectedAccount.id, readerMessage.id);
                    }
                  }}
                  onMarkSpam={() => {
                    if (selectedAccount?.id && readerMessage?.id) {
                      void handleMarkSpam(selectedAccount.id, readerMessage.id);
                    }
                  }}
                  onMarkUnread={() => {
                    if (selectedAccount?.id && readerMessage?.id) {
                      void handleMarkUnread(selectedAccount.id, readerMessage.id);
                    }
                  }}
                  onMove={(targetFolderName) => {
                    if (selectedAccount?.id && readerMessage?.id) {
                      void handleMoveMessage(selectedAccount.id, readerMessage.id, targetFolderName);
                    }
                  }}
                  onToggleFlag={(flagged) => {
                    if (selectedAccount?.id && readerMessage?.id) {
                      void handleToggleFlag(selectedAccount.id, readerMessage.id, flagged);
                    }
                  }}
                  onForward={() =>
                    openComposer(selectedAccount?.id, {
                      to: "",
                      subject: withSubjectPrefix(selectedThread?.subject ?? "", "Fwd"),
                      body: activeThreadMessage
                        ? buildQuotedReplyBody(
                            activeThreadMessage.sentAt,
                            activeThreadMessage.sender,
                            activeThreadMessage.body
                          )
                        : "",
                      replyToMessageId: undefined
                    })
                  }
                  onReplyAll={() => {
                    const senderAddress = activeThreadMessage?.address ?? "";
                    const accountAddress = selectedAccount?.address?.toLowerCase() ?? "";
                    const replyAllCc = mergeUniqueAddresses(
                      splitAddresses(activeThreadMessage?.to).filter((entry) => entry.toLowerCase() !== accountAddress && entry.toLowerCase() !== senderAddress.toLowerCase()),
                      splitAddresses(activeThreadMessage?.cc).filter((entry) => entry.toLowerCase() !== accountAddress && entry.toLowerCase() !== senderAddress.toLowerCase())
                    );

                    openComposer(selectedAccount?.id, {
                      to: senderAddress,
                      cc: replyAllCc.join(", "),
                      subject: withSubjectPrefix(selectedThread?.subject ?? "", "Re"),
                      body: activeThreadMessage
                        ? buildQuotedReplyBody(
                            activeThreadMessage.sentAt,
                            activeThreadMessage.sender,
                            activeThreadMessage.body
                          )
                        : "",
                      replyToMessageId: activeThreadMessage?.id
                    });
                  }}
                  onReply={() =>
                    openComposer(selectedAccount?.id, {
                      to: activeThreadMessage?.address ?? "",
                      subject: withSubjectPrefix(selectedThread?.subject ?? "", "Re"),
                      body: activeThreadMessage
                        ? buildQuotedReplyBody(
                            activeThreadMessage.sentAt,
                            activeThreadMessage.sender,
                            activeThreadMessage.body
                          )
                        : "",
                      replyToMessageId: activeThreadMessage?.id
                    })
                  }
                  readerMessage={readerMessage}
                  thread={selectedThread}
                />
              )}
            </section>
          </section>
        </>
      )}
    </main>
  );
}

export default App;
