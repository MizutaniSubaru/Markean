import {
  FolderIcon,
  PlusIcon,
  SearchIcon,
} from "../shared/Icons";
import { useI18n } from "../../i18n";

type SidebarFolder = {
  id: string;
  name: string;
  count: number;
};

type SidebarProps = {
  folders: SidebarFolder[];
  activeFolderId: string;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSelectFolder: (folderId: string) => void;
  onCreateFolder: () => void;
};

export function Sidebar({
  folders,
  activeFolderId,
  searchQuery,
  onSearchChange,
  onSelectFolder,
  onCreateFolder,
}: SidebarProps) {
  const { t } = useI18n();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">{t("sidebar.title")}</h1>
        <button
          type="button"
          className="sidebar-btn"
          onClick={onCreateFolder}
          aria-label={t("sidebar.newFolder")}
        >
          <PlusIcon />
        </button>
      </div>

      <div className="sidebar-search">
        <SearchIcon />
        <input
          aria-label={t("sidebar.search")}
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("sidebar.search")}
        />
      </div>

      <div className="sidebar-scroll">
        {folders.map((folder) => {
          const isActive = folder.id === activeFolderId;
          return (
            <button
              key={folder.id}
              type="button"
              className={`folder-item${isActive ? " active" : ""}`}
              aria-pressed={isActive}
              onClick={() => onSelectFolder(folder.id)}
            >
              <div className="folder-icon">
                <FolderIcon color={isActive ? "white" : "#007AFF"} />
              </div>
              <span className="folder-name">{folder.name}</span>
              <span className="folder-count">{folder.count}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
