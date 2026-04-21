import { markdownToPlainText } from "@markean/domain";
import type { SyncStatus, WorkspaceNote } from "../../lib/storage";
import { Editor as FeatureEditor } from "../../features/notes/components/desktop/Editor";

type EditorProps = {
  note: WorkspaceNote | null;
  syncStatus: SyncStatus;
  onChangeBody: (body: string) => void;
};

export function Editor({ note, onChangeBody }: EditorProps) {
  return (
    <FeatureEditor
      note={
        note
          ? {
              id: note.id,
              folderId: note.folderId,
              title: note.title,
              bodyMd: note.body,
              bodyPlain: markdownToPlainText(note.body),
              currentRevision: 0,
              updatedAt: note.updatedAt,
              deletedAt: null,
            }
          : null
      }
      onChangeBody={onChangeBody}
    />
  );
}
