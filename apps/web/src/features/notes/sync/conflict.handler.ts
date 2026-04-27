import type { NoteRecord } from "@markean/domain";
import { getDb } from "../persistence/db";
import { createNote } from "../persistence/notes.persistence";
import { useNotesStore } from "../store/notes.store";

type Conflict = {
  entityType: string;
  entityId: string;
  serverRevision: number;
};

export async function handleConflicts(conflicts: Conflict[]): Promise<void> {
  const db = getDb();
  const processedNoteIds = new Set<string>();

  for (const conflict of conflicts) {
    if (conflict.entityType !== "note") continue;
    if (processedNoteIds.has(conflict.entityId)) continue;

    processedNoteIds.add(conflict.entityId);

    const localNote = await db.notes.get(conflict.entityId);
    if (!localNote) continue;

    const originalChanges = await db.pendingChanges
      .where("entityId")
      .equals(conflict.entityId)
      .filter((change) => change.entityType === "note")
      .toArray();
    const copyTitle = `${localNote.title} (conflict copy)`;
    const existingCopy = await db.notes
      .filter(
        (note) =>
          note.id !== localNote.id &&
          note.folderId === localNote.folderId &&
          note.title === copyTitle &&
          note.bodyMd === localNote.bodyMd &&
          note.bodyPlain === localNote.bodyPlain &&
          note.currentRevision === 0,
      )
      .first();
    if (originalChanges.length === 0 && existingCopy) continue;

    const copy: NoteRecord = {
      ...localNote,
      id: `note_${crypto.randomUUID()}`,
      title: copyTitle,
      currentRevision: 0,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };

    await createNote(copy);
    await db.pendingChanges
      .where("clientChangeId")
      .anyOf(originalChanges.map((change) => change.clientChangeId))
      .delete();
    useNotesStore.getState().addConflictCopy(copy);
  }
}
