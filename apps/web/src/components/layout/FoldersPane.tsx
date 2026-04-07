type Folder = {
  id: string;
  name: string;
  count: number;
};

type FoldersPaneProps = {
  folders: Folder[];
  activeFolderId: string;
};

export function FoldersPane({ folders, activeFolderId }: FoldersPaneProps) {
  return (
    <section className="pane pane--folders" aria-labelledby="folders-title">
      <div className="pane__header">
        <h2 className="pane__title" id="folders-title">
          Folders
        </h2>
        <p className="pane__subtitle">Organize the day before you write.</p>
      </div>
      <ul className="pane-list">
        {folders.map((folder) => (
          <li key={folder.id}>
            <button
              className="pane-list__item"
              type="button"
              data-active={folder.id === activeFolderId ? "true" : undefined}
            >
              <span>{folder.name}</span>
              <span className="pane-list__meta">{folder.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
