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
            contentMode: fetchedMessage.html ? "html-blocked" : "plain"
          }
        : message
    )
  }))
});

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

  useEffect(() => {
    const desktopApi = window.desktopApi;
    if (!desktopApi || !selectedAccountId || !selectedFolder?.name) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void desktopApi
        .syncFolder({
          accountId: selectedAccountId,
          folderName: selectedFolder.name
        })
        .then((result) => {
          if (result.data) {
            applyWorkspace(result.data);
          }
          if (!result.ok) {
            throw new Error(result.error);
          }
        })
        .catch((error) => {
          setActionError(error instanceof Error ? error.message : "Automatic folder sync failed.");
        });
    }, 300000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [selectedAccountId, selectedFolder?.name]);

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
      setActionNotice("Message deleted.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Message delete failed.");
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
      setActionNotice(`Stored ${accountForm.address} in the local account vault.`);
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
      setActionNotice("Draft stored locally.");
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
      setActionNotice("Account verification completed and server folders were refreshed.");
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
      setActionNotice("Message submitted through SMTP.");
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

            {loadError ? <p className="inline-notice">{loadError}</p> : null}
            {actionError ? <p className="inline-notice inline-notice-critical">{actionError}</p> : null}
            {actionNotice ? <p className="inline-notice inline-notice-success">{actionNotice}</p> : null}
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
              {loadError ? <p className="inline-notice">{loadError}</p> : null}
              {actionError ? <p className="inline-notice inline-notice-critical">{actionError}</p> : null}
              {actionNotice ? <p className="inline-notice inline-notice-success">{actionNotice}</p> : null}
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
                  loadingMessageBodyId={loadingMessageBodyId}
                  onDelete={() => {
                    if (selectedAccount?.id && readerMessage?.id) {
                      void handleDeleteMessage(selectedAccount.id, readerMessage.id);
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
