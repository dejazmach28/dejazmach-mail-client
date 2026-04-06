import type { AccountSummary, FolderSummary } from "../../shared/contracts.js";

type SidebarProps = {
  appName: string;
  accounts: AccountSummary[];
  folders: FolderSummary[];
  selectedAccountId: string;
  selectedFolderId: string;
  onCompose: () => void;
  onSelectAccount: (accountId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onShowSettings: () => void;
  onShowAddAccount: () => void;
};

const getInitials = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "M";

export function Sidebar({
  appName,
  accounts,
  folders,
  selectedAccountId,
  selectedFolderId,
  onCompose,
  onSelectAccount,
  onSelectFolder,
  onShowSettings,
  onShowAddAccount
}: SidebarProps) {
  return (
    <aside className="sidebar-pane">
      <div className="sidebar-brand">
        <div className="brand-orb">D</div>
        <div>
          <span className="eyebrow eyebrow-inverse">Secure desktop mail</span>
          <h1>{appName}</h1>
        </div>
      </div>

      <button className="compose-button" onClick={onCompose} type="button">
        New message
      </button>

      <section className="sidebar-section">
        <div className="sidebar-section-header">
          <span className="eyebrow eyebrow-inverse">Accounts</span>
        </div>

        <div className="account-stack">
          {accounts.map((account) => (
            <button
              className={account.id === selectedAccountId ? "account-tile account-tile-active" : "account-tile"}
              key={account.id}
              onClick={() => onSelectAccount(account.id)}
              type="button"
            >
              <span className="account-avatar">{getInitials(account.name)}</span>
              <span className="account-copy">
                <strong>{account.name}</strong>
                <span>{account.address}</span>
              </span>
              <span className="account-count">{account.unreadCount}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="sidebar-section sidebar-section-grow">
        <div className="sidebar-section-header">
          <span className="eyebrow eyebrow-inverse">Folders</span>
        </div>

        {folders.length > 0 ? (
          <div className="folder-stack">
            {folders.map((folder) => (
              <button
                className={folder.id === selectedFolderId ? "folder-tile folder-tile-active" : "folder-tile"}
                key={folder.id}
                onClick={() => onSelectFolder(folder.id)}
                type="button"
              >
                <span>{folder.name}</span>
                <span className="folder-count">{folder.count}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="sidebar-empty">
            Verify this account to fetch the real folder tree from the IMAP server.
          </div>
        )}
      </section>

      <section className="sidebar-footer">
        <button className="sidebar-action" onClick={onShowSettings} type="button">
          Account settings
        </button>
        <button className="sidebar-action sidebar-action-muted" onClick={onShowAddAccount} type="button">
          Add account
        </button>
      </section>
    </aside>
  );
}
