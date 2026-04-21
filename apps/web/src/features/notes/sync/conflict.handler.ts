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

  for (const conflict of conflicts) {
    if (conflict.entityType !== "note") {
      continue;
    }

    const localNote = await db.notes.get(conflict.entityId);
    if (!localNote) {
      continue;
    }

    const copy: NoteRecord = {
      ...localNote,
      id: `note_${crypto.randomUUID()}`,
      title: `${localNote.title} (conflict copy)`,
      currentRevision: 0,
      updatedAt: new Date().toISOString(),
    };

    await createNote(copy);
    useNotesStore.getState().addConflictCopy(copy);
  }
}
