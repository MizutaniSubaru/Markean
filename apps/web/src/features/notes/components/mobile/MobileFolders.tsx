import { useI18n } from "../../../../i18n";
import { ChevronIcon, ComposeIcon, SearchIcon } from "../shared/Icons";
import "../../../../styles/mobile.css";

type MobileFolder = {
  id: string;
  name: string;
  count: number;
};

type MobileFoldersProps = {
  folders: MobileFolder[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSelectFolder: (folderId: string) => void;
  onCreateNote: () => void;
};

export function MobileFolders({
  folders,
  searchQuery,
  onSearchChange,
  onSelectFolder,
  onCreateNote,
}: MobileFoldersProps) {
  const { t } = useI18n();

  return (
    <section className="mobile-app">
      <div className="mobile-nav">
        <div className="mobile-nav-actions" />
        <div className="mobile-nav-title">{t("mobile.folders")}</div>
        <div className="mobile-nav-actions" />
      </div>

      <div className="mobile-page">
        <div className="mobile-page-title">{t("mobile.folders")}</div>
        <div className="mobile-folder-group">
          <div className="mobile-folder-card">
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className="mobile-folder-row"
                onClick={() => onSelectFolder(folder.id)}
              >
                <span className="mobile-folder-row-name">{folder.name}</span>
                <span className="mobile-folder-row-count">{folder.count}</span>
                <span className="mobile-folder-row-chevron" aria-hidden="true">
                  <ChevronIcon />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mobile-bottom-bar">
        <label className="mobile-search-bar">
          <SearchIcon />
          <input
            aria-label={t("sidebar.search")}
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("sidebar.search")}
          />
        </label>
        <button
          type="button"
          className="mobile-compose-btn"
          aria-label={t("noteList.newNote")}
          onClick={onCreateNote}
        >
          <ComposeIcon color="currentColor" />
        </button>
      </div>
    </section>
  );
}
