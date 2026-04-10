type Folder = {
  id: string;
  name: string;
  count: number;
};

type FoldersPaneProps = {
  folders: Folder[];
  activeFolderId: string;
  onCreateFolder: () => void;
  onHide?: () => void;
  onSelectFolder: (folderId: string) => void;
};

export function FoldersPane({
  folders,
  activeFolderId,
  onSelectFolder,
}: FoldersPaneProps) {
  return (
    <>
      <div className="sidebar-header">Folders</div>
      {folders.map((folder) => (
        <div
          key={folder.id}
          className={`sidebar-item ${folder.id === activeFolderId ? "active" : ""}`.trim()}
          onClick={() => onSelectFolder(folder.id)}
        >
          <span className="sidebar-icon">📁</span>
          <span>{folder.name}</span>
        </div>
      ))}
    </>
  );
}
