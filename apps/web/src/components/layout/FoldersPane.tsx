import { FolderIcon, FolderPlusIcon, SidebarIcon } from "./icons";

type Folder = {
  id: string;
  name: string;
  count: number;
};

type FoldersPaneProps = {
  folders: Folder[];
  activeFolderId: string;
  onCreateFolder: () => void;
  onHide: () => void;
  onSelectFolder: (folderId: string) => void;
};

export function FoldersPane({
  folders,
  activeFolderId,
  onCreateFolder,
  onHide,
  onSelectFolder,
}: FoldersPaneProps) {
  return (
    <section className="pane pane--folders" aria-labelledby="folders-title">
      <div className="pane__toolbar">
        <button className="pane-icon-button" type="button" aria-label="New folder" onClick={onCreateFolder}>
          <FolderPlusIcon className="pane-icon-button__icon" />
        </button>
        <button className="pane-icon-button" type="button" aria-label="Hide folders" onClick={onHide}>
          <SidebarIcon className="pane-icon-button__icon" />
        </button>
      </div>

      <div className="pane__header pane__header--stacked">
        <p className="pane__eyebrow">iCloud</p>
        <h2 className="pane__title" id="folders-title">
          Folders
        </h2>
        <p className="pane__subtitle">A lighter stack for projects, notes, and references.</p>
      </div>

      <div className="pane__body">
        <ul className="folders-list">
          {folders.map((folder) => (
            <li key={folder.id}>
              <button
                className="folder-row"
                type="button"
                data-active={folder.id === activeFolderId ? "true" : undefined}
                onClick={() => onSelectFolder(folder.id)}
              >
                <span className="folder-row__lead">
                  <FolderIcon className="folder-row__icon" />
                  <span className="folder-row__label">{folder.name}</span>
                </span>
                <span className="folder-row__count">{folder.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
