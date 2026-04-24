import { useEffect } from "react";
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

  useEffect(() => {
    console.log("[sidebar] selected account:", selectedAccountId);
    console.log(
      "[sidebar] folders received:",
      folders.map((folder) => ({
        id: folder.id,
        accountId: folder.accountId ?? null,
        name: folder.name,
        count: folder.count
      }))
    );
  }, [folders, selectedAccountId]);

  return (
    <aside className="sidebar-pane">
      <div className="sidebar-brand">
        <div className="brand-orb">D</div>
        <div>
          <span className="eyebrow eyebrow-inverse">Secure desktop mail</span>
          <h1>{appName}</h1>
        </div>
      </div>

      <button className="compose-button" onClick={() => { onCompose(); onCloseSidebar?.(); }} type="button">
        New message
      </button>

      <section className="sidebar-section">
        <div
          className="sidebar-section-header sidebar-section-header-static"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <span className="eyebrow eyebrow-inverse">Accounts</span>
        </div>

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
              <span className="account-avatar">{getInitials(account.name)}</span>
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
            <div
              className="sidebar-section-header sidebar-section-header-static"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <span className="eyebrow eyebrow-inverse">Folders</span>
            </div>
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
