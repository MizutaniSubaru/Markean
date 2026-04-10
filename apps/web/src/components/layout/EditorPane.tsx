import { LiveEditor } from "./LiveEditor";
import { SyncBadge } from "./SyncBadge";
import type { WorkspaceNote } from "../../lib/storage";

type EditorPaneProps = {
  note: WorkspaceNote | null;
  previewMode: boolean;
  onCreateNote: () => void;
  onChangeBody: (body: string) => void;
  onChangeTitle: (title: string) => void;
  onTogglePreview: (preview: boolean) => void;
};

export function EditorPane({ note, onChangeBody }: EditorPaneProps) {
  if (!note) {
    return <div className="editor-content-area">No note selected.</div>;
  }

  return (
    <>
      <header className="editor-toolbar">
        <div className="toolbar-left">
           <SyncBadge status="idle" />
        </div>
        <div className="toolbar-right">
          <input type="text" className="search-box" placeholder="Search" />
        </div>
      </header>
      <div className="editor-content-area">
        <LiveEditor 
          key={note.id}
          initialValue={note.body} 
          onChange={(val) => {
             onChangeBody(val);
          }} 
        />
      </div>
    </>
  );
}
