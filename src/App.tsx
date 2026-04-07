import { useEffect, useState, type FormEvent } from "react";
import type {
  ActionResult,
  CreateAccountInput,
  CreateDraftInput,
  FetchMessageBodyResult,
  WorkspaceSnapshot
} from "../shared/contracts.js";
import { ComposePanel } from "./components/ComposePanel.js";
import { MessageList } from "./components/MessageList.js";
import { MessageReader } from "./components/MessageReader.js";
import { OnboardingForm } from "./components/OnboardingForm.js";
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
    workspace.messages.find((message) => message.accountId === accountId)?.threadId ??
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
  const [accountForm, setAccountForm] = useState<CreateAccountInput>(initialAccountForm);
  const [draftForm, setDraftForm] = useState<CreateDraftInput>({
    accountId: "",
    to: "",
    cc: "",
    subject: "",
    body: ""
  });

  const applyWorkspace = (nextWorkspace: WorkspaceSnapshot) => {
    const nextAccountId = nextWorkspace.accounts.some((account) => account.id === selectedAccountId)
      ? selectedAccountId
      : (nextWorkspace.accounts[0]?.id ?? "");
    const nextFolderId = nextWorkspace.folders.some((folder) => folder.id === selectedFolderId)
      ? selectedFolderId
      : getFirstFolderId(nextWorkspace, nextAccountId);
    const nextThreadId = nextWorkspace.threads.some((thread) => thread.id === selectedThreadId)
      ? selectedThreadId
      : getFirstThreadId(nextWorkspace, nextAccountId, nextFolderId);

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
  const accountMessages = selectedAccount
    ? workspace.messages.filter((message) => message.accountId === selectedAccount.id)
    : [];
  const search = searchQuery.trim().toLowerCase();
  const folderMessages = selectedAccount
    ? accountMessages.filter((message) => message.folderId === selectedFolder?.id)
    : [];
  const visibleMessages = !search
    ? folderMessages
    : folderMessages.filter((message) =>
        [message.sender, message.subject, message.preview, message.label].some((value) =>
          value.toLowerCase().includes(search)
        )
      );
  const selectedThread =
    workspace.threads.find((thread) => thread.id === selectedThreadId) ??
    workspace.threads.find((thread) => thread.id === visibleMessages[0]?.threadId);
  const readerMessage = visibleMessages.find((message) => message.threadId === selectedThread?.id);
  const activeThreadMessage = selectedThread?.messages[0];
  const recentActivity = workspace.shellState.transparencyLedger.slice(0, 4);
  const recentSecurityMetrics = workspace.shellState.securityMetrics.slice(0, 4);
  const recentSyncJobs = workspace.syncJobs.slice(0, 3);

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
    setDraftForm((currentDraft) => ({
      ...currentDraft,
      to: "",
      cc: "",
      subject: "",
      body: "",
      replyToMessageId: undefined
    }));
  };

  const chooseAccount = (accountId: string) => {
    const nextFolderId = getFirstFolderId(workspace, accountId);
    setSelectedAccountId(accountId);
    setSelectedFolderId(nextFolderId);
    setSelectedThreadId(getFirstThreadId(workspace, accountId, nextFolderId));
    setActiveSurface("message");
  };

  const chooseFolder = (folderId: string) => {
    if (!selectedAccount) {
      return;
    }

    setSelectedFolderId(folderId);
    setSelectedThreadId(getFirstThreadId(workspace, selectedAccount.id, folderId));
    setActiveSurface("message");
  };

  const openComposer = (
    accountId = selectedAccount?.id ?? workspace.accounts[0]?.id ?? "",
    overrides: Partial<CreateDraftInput> = {}
  ) => {
    setDraftForm((currentDraft) => ({
      ...currentDraft,
      accountId,
      ...overrides
    }));
    setActiveSurface("compose");
  };

  const discardDraft = () => {
    resetDraftFields();
    setActiveSurface("message");
  };

  const openMessage = async (messageId: string, threadId: string, accountId: string) => {
    setSelectedThreadId(threadId);
    setActiveSurface("message");
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
      if (selectedMessage?.unread) {
        const readResult = await window.desktopApi.markRead({ accountId, messageId });
        if (readResult.data) {
          applyWorkspace(readResult.data);
        }
        unwrapResult(readResult);
      }

      if (!needsRemoteFetch) {
        return;
      }

      setLoadingMessageBodyId(messageId);
      const result = await window.desktopApi.fetchMessageBody({ accountId, messageId });
      if (result.data) {
        const fetchedMessage = result.data;
        setWorkspace((currentWorkspace) => applyFetchedMessageBody(currentWorkspace, messageId, fetchedMessage));
      }
      unwrapResult(result);
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

  const handleAccountSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError(null);
    setActionNotice(null);

    if (!window.desktopApi) {
      setActionError("Account onboarding requires the Electron desktop shell.");
      return;
    }

    setIsSavingAccount(true);

    try {
      const nextWorkspace = unwrapResult(await window.desktopApi.createAccount(accountForm));
      const createdAccount = nextWorkspace.accounts[nextWorkspace.accounts.length - 1];
      applyWorkspace(nextWorkspace);

      if (createdAccount) {
        const nextFolderId = getFirstFolderId(nextWorkspace, createdAccount.id);
        setSelectedAccountId(createdAccount.id);
        setSelectedFolderId(nextFolderId);
        setSelectedThreadId(getFirstThreadId(nextWorkspace, createdAccount.id, nextFolderId));
        setDraftForm((currentDraft) => ({ ...currentDraft, accountId: createdAccount.id }));
      }

      setAccountForm(initialAccountForm);
      setShowAccountSetup(false);
      setActiveSurface("message");
      showActionNotice(`Stored ${accountForm.address} in the local account vault.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Account onboarding failed.");
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
      showActionNotice("Draft stored locally.");
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
      const result = await window.desktopApi.sendMessage(draftForm);
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

          <section className="workspace-frame">
            <Sidebar
              accounts={workspace.accounts}
              appName={workspace.shellState.appName}
              folders={visibleFolders}
              onCompose={() => openComposer()}
              onSelectAccount={chooseAccount}
              onSelectFolder={chooseFolder}
              onShowAddAccount={() => setShowAccountSetup(true)}
              onShowSettings={() => setActiveSurface("settings")}
              selectedAccountId={selectedAccount?.id ?? ""}
              selectedFolderId={selectedFolder?.id ?? ""}
            />

            <MessageList
              accountId={selectedAccount?.id}
              accountStatus={selectedAccount?.status}
              folderName={selectedFolder?.name ?? "Folders"}
              messages={visibleMessages}
              onOpenMessage={openMessage}
              onSearchQueryChange={setSearchQuery}
              onSyncComplete={applyWorkspace}
              onSyncError={(message) => setActionError(message)}
              searchQuery={searchQuery}
              selectedFolderName={selectedFolder?.name}
              selectedThreadId={selectedThread?.id ?? ""}
              unreadCount={selectedAccount?.unreadCount}
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
                  onSignatureSaved={() => showActionNotice("Signature saved.", 2000)}
                  onVerifyAccount={(accountId) => {
                    void handleVerifyAccount(accountId);
                  }}
                  platform={workspace.shellState.platform}
                  recentActivity={recentActivity}
                  recentSecurityMetrics={recentSecurityMetrics}
                  recentSyncJobs={recentSyncJobs}
                  selectedAccount={selectedAccount}
                  verifyingAccountId={verifyingAccountId}
                />
              ) : (
                <MessageReader
                  folders={visibleFolders.map((folder) => ({ id: folder.id, name: folder.name }))}
                  loadingMessageBodyId={loadingMessageBodyId}
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
