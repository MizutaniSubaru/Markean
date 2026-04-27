import { markdownToPlainText } from "@markean/domain";
import { getScheduler } from "../../../app/bootstrap";
import { updateNote as persistNoteUpdate } from "../persistence/notes.persistence";
import { useNotesStore } from "../store/notes.store";
import { useSyncStore } from "../store/sync.store";

type EditorActions = {
  changeBody: (noteId: string, bodyMd: string) => Promise<void>;
};

function deriveTitleFromBody(bodyMd: string): string {
  return (
    bodyMd
      .split(/\n+/)
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find(Boolean) ?? ""
  );
}

export function useEditorActions(): EditorActions {
  const updateNote = useNotesStore((state) => state.updateNote);

  return {
    async changeBody(noteId, bodyMd) {
      const title = deriveTitleFromBody(bodyMd);
      const bodyPlain = markdownToPlainText(bodyMd);

      updateNote(noteId, { bodyMd, title });
      useSyncStore.getState().markUnsynced();
      await persistNoteUpdate(noteId, { bodyMd, bodyPlain, title });
      getScheduler()?.requestSync();
    },
  };
}
