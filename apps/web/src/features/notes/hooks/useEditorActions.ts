import { markdownToPlainText, type NoteRecord } from "@markean/domain";
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

function restoreIfOptimisticWriteUnchanged(
  noteId: string,
  previousNote: NoteRecord,
  optimisticNote: NoteRecord,
): void {
  useNotesStore.setState((state) => ({
    notes: state.notes.map((note) =>
      note.id === noteId && note === optimisticNote ? previousNote : note,
    ),
  }));
}

export function useEditorActions(): EditorActions {
  const updateNote = useNotesStore((state) => state.updateNote);

  return {
    async changeBody(noteId, bodyMd) {
      const existing = useNotesStore.getState().notes.find((note) => note.id === noteId);
      if (!existing) return;

      const previousNote = { ...existing };
      const title = deriveTitleFromBody(bodyMd);
      const bodyPlain = markdownToPlainText(bodyMd);

      updateNote(noteId, { bodyMd, title });
      const optimisticNote = useNotesStore.getState().notes.find((note) => note.id === noteId);
      if (!optimisticNote) return;

      let persisted = false;
      try {
        persisted = await persistNoteUpdate(noteId, { bodyMd, bodyPlain, title });
      } catch (error) {
        restoreIfOptimisticWriteUnchanged(noteId, previousNote, optimisticNote);
        throw error;
      }

      if (!persisted) {
        restoreIfOptimisticWriteUnchanged(noteId, previousNote, optimisticNote);
        return;
      }

      useSyncStore.getState().markUnsynced();
      getScheduler()?.requestSync();
    },
  };
}
