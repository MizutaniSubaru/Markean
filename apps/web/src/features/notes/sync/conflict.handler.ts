import type { NoteRecord } from "@markean/domain";
import { queueChange } from "@markean/sync-core";
import { getDb } from "../persistence/db";
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

    const copy: NoteRecord = {
      ...localNote,
      id: `note_${crypto.randomUUID()}`,
      title: copyTitle,
      currentRevision: 0,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };

    await db.transaction("rw", db.notes, db.pendingChanges, async () => {
      await db.notes.put(copy);
      await queueChange(db, {
        entityType: "note",
        entityId: copy.id,
        operation: "create",
        baseRevision: 0,
      });
      if (originalChanges.length > 0) {
        await db.pendingChanges
          .where("clientChangeId")
          .anyOf(originalChanges.map((change) => change.clientChangeId))
          .delete();
      }
    });
    useNotesStore.getState().addConflictCopy(copy);
  }
}
