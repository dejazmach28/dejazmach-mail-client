import type { AccountSummary, FolderSummary } from "../../shared/contracts.js";
import { getAvatarColor } from "../utils/avatarColor.js";

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
  onRequestReauth: (accountId: string) => void;
  onCloseSidebar?: () => void;
};

const getInitials = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "M";

const splitFolderPath = (value: string) =>
  value
    .split(/[/.]/)
    .map((part) => part.trim())
    .filter(Boolean);

const getFolderLeafName = (value: string) => {
  const parts = splitFolderPath(value);
  return parts[parts.length - 1] ?? value;
};

const getFolderIcon = (folder: FolderSummary) => {
  const normalizedName = getFolderLeafName(folder.name).trim().toLowerCase();
  const normalizedFullName = folder.name.trim().toLowerCase();

  if (["inbox"].includes(normalizedName)) {
    return "✉";
  }

  if (["sent", "sent items", "sent mail"].includes(normalizedName)) {
    return "↗";
  }

  if (["drafts", "draft"].includes(normalizedName)) {
    return "✎";
  }

  if (["trash", "deleted", "deleted items", "bin"].includes(normalizedName)) {
    return "🗑";
  }

  if (["archive", "all mail"].includes(normalizedName) || normalizedFullName === "[gmail]/all mail") {
    return "📦";
  }

  if (["spam", "junk", "junk email"].includes(normalizedName)) {
    return "🛡";
  }

  return "📁";
};

const systemFolderOrder = [
  "inbox",
  "sent",
  "drafts",
  "junk",
  "trash",
  "archive"
] as const;

const getSystemFolderKey = (folder: FolderSummary) => {
  const normalizedName = getFolderLeafName(folder.name).trim().toLowerCase();
  const normalizedFullName = folder.name.trim().toLowerCase();

  if (normalizedName === "inbox") {
    return "inbox";
  }

  if (["sent", "sent items", "sent mail"].includes(normalizedName)) {
    return "sent";
  }

  if (["drafts", "draft"].includes(normalizedName)) {
    return "drafts";
  }

  if (["junk", "junk email", "spam"].includes(normalizedName)) {
    return "junk";
  }

  if (["trash", "deleted", "deleted items", "bin"].includes(normalizedName)) {
    return "trash";
  }

  if (["archive", "all mail"].includes(normalizedName) || normalizedFullName === "[gmail]/all mail") {
    return "archive";
  }

  return null;
};

type FolderRenderItem =
  | {
      type: "parent";
      key: string;
      label: string;
      depth: number;
    }
  | {
      type: "folder";
      key: string;
      label: string;
      depth: number;
      folder: FolderSummary;
    };

const buildCustomFolderItems = (folders: FolderSummary[]) => {
  const items: FolderRenderItem[] = [];
  const seenParents = new Set<string>();

  for (const folder of folders) {
    const parts = splitFolderPath(folder.name);

    if (parts.length > 1) {
      for (let index = 0; index < parts.length - 1; index += 1) {
        const parentPath = parts.slice(0, index + 1).join("/").toLowerCase();
        if (seenParents.has(parentPath)) {
          continue;
        }

        seenParents.add(parentPath);
        items.push({
          type: "parent",
          key: `parent:${parentPath}`,
          label: parts[index],
          depth: index
        });
      }
    }

    items.push({
      type: "folder",
      key: folder.id,
      label: parts.length > 1 ? parts[parts.length - 1] : folder.name,
      depth: Math.max(0, parts.length - 1),
      folder
    });
  }

  return items;
};

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
  onShowAddAccount,
  onRequestReauth,
  onCloseSidebar
}: SidebarProps) {
  const systemFolders = systemFolderOrder
    .map((key) => folders.find((folder) => getSystemFolderKey(folder) === key))
    .filter((folder): folder is FolderSummary => Boolean(folder));
  const customFolders = folders
    .filter((folder) => !getSystemFolderKey(folder))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  const customFolderItems = buildCustomFolderItems(customFolders);

  return (
    <aside className="sidebar-pane">
      <div className="sidebar-brand">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" className="sidebar-brand-logo" aria-hidden="true">
          <rect x="4" y="14" width="56" height="40" rx="6" fill="#c2410c" />
          <rect x="14" y="22" width="36" height="4" rx="2" fill="#1c1917" opacity="0.85" />
          <rect x="18" y="30" width="28" height="20" rx="2" fill="#fef9f3" />
          <line x1="22" y1="38" x2="42" y2="38" stroke="#c2410c" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="22" y1="42" x2="38" y2="42" stroke="#c2410c" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="22" y1="46" x2="34" y2="46" stroke="#c2410c" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-tagline">Secure desktop mail</span>
          <span className="sidebar-brand-name">{appName}</span>
        </div>
      </div>

      <button className="compose-button" onClick={() => { onCompose(); onCloseSidebar?.(); }} type="button">
        <span>Compose</span>
        <span className="compose-shortcut-badge">C</span>
      </button>

      <section className="sidebar-section">
        <span className="sidebar-section-label">Accounts</span>

        <div className="account-stack">
          {accounts.map((account) => (
            <button
              className={account.id === selectedAccountId ? "account-tile account-tile-active" : "account-tile"}
              key={account.id}
              onClick={() => {
                onSelectAccount(account.id);
                if (account.needsReauth) {
                  onRequestReauth(account.id);
                }
              }}
              type="button"
            >
              <span className="account-avatar" style={{ background: getAvatarColor(account.name) }}>{getInitials(account.name)}</span>
              <span className="account-copy">
                <strong>
                  {account.name}
                  {account.needsReauth ? (
                    <span
                      className="account-reauth-badge"
                      title="Password required — click to re-authenticate"
                    >
                      ⚠
                    </span>
                  ) : null}
                </strong>
                <span>{account.address}</span>
              </span>
              <span className="account-meta">
                <span className={`account-status-badge account-status-${account.status}`}>{account.status}</span>
                <span className="account-count">{account.unreadCount}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="sidebar-section sidebar-section-grow">
        {folders.length > 0 ? (
          <>
            <span className="sidebar-section-label">Inboxes</span>
            <div className="folder-stack">
              {systemFolders.map((folder) => (
                <button
                  className={folder.id === selectedFolderId ? "folder-tile folder-tile-active" : "folder-tile"}
                  key={folder.id}
                  onClick={() => { onSelectFolder(folder.id); onCloseSidebar?.(); }}
                  type="button"
                >
                  <span>
                    <span className="folder-icon" aria-hidden="true">
                      {getFolderIcon(folder)}
                    </span>
                    {getSystemFolderKey(folder) === "junk" ? "Spam" : folder.name}
                  </span>
                  {folder.count > 0 ? <span className="folder-count">{folder.count}</span> : null}
                </button>
              ))}

              {customFolderItems.length > 0 ? <div className="folder-divider" aria-hidden="true" /> : null}

              {customFolderItems.map((item) =>
                item.type === "parent" ? (
                  <div
                    className="folder-parent folder-parent-static"
                    key={item.key}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    style={{ paddingLeft: `${12 + item.depth * 18}px` }}
                  >
                    <span className="folder-parent-chevron" aria-hidden="true">
                      ▾
                    </span>
                    <span>{item.label}</span>
                  </div>
                ) : (
                  <button
                    className={
                      item.folder.id === selectedFolderId
                        ? "folder-tile folder-tile-active"
                        : "folder-tile"
                    }
                    key={item.key}
                    onClick={() => { onSelectFolder(item.folder.id); onCloseSidebar?.(); }}
                    style={{ paddingLeft: `${12 + item.depth * 18}px` }}
                    type="button"
                  >
                    <span className={item.depth > 0 ? "folder-label folder-label-nested" : "folder-label"}>
                      <span className="folder-icon" aria-hidden="true">
                        {getFolderIcon(item.folder)}
                      </span>
                      {item.label}
                    </span>
                    {item.folder.count > 0 ? <span className="folder-count">{item.folder.count}</span> : null}
                  </button>
                )
              )}
            </div>
          </>
        ) : (
          <p className="sidebar-empty">No folders synced yet</p>
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
