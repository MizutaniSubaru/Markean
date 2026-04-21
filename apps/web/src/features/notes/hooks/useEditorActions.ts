import { useCallback } from "react";
import { markdownToPlainText } from "@markean/domain";
import { getScheduler } from "../../../app/bootstrap";
import { updateNote as persistUpdateNote } from "../persistence/notes.persistence";
import { useNotesStore } from "../store/notes.store";
import { useSyncStore } from "../store/sync.store";

export function useEditorActions() {
  const updateNote = useNotesStore((state) => state.updateNote);

  const changeBody = useCallback(
    (noteId: string, bodyMd: string) => {
      const title =
        bodyMd
          .split(/\n+/)
          .map((line) => line.replace(/^#+\s*/, "").trim())
          .find(Boolean) ?? "";

      updateNote(noteId, { bodyMd, title });
      useSyncStore.getState().markUnsynced();

      void persistUpdateNote(noteId, {
        bodyMd,
        bodyPlain: markdownToPlainText(bodyMd),
        title,
      });

      getScheduler()?.requestSync();
    },
    [updateNote],
  );

  return { changeBody };
}
