import type { NoteRecord } from "@markean/domain";
import { queueChange } from "@markean/sync-core";
import { getDb } from "../persistence/db";
import { useNotesStore } from "../store/notes.store";

type Conflict = {
  entityType: string;
  entityId: string;
  serverRevision: number;
};

type ConflictHandlerOptions = {
  shouldApply?: () => boolean;
};

class ConflictHandlingCancelledError extends Error {
  constructor() {
    super("Conflict handling cancelled");
  }
}

function shouldApply(options: ConflictHandlerOptions): boolean {
  return options.shouldApply?.() ?? true;
}

function throwIfCancelled(options: ConflictHandlerOptions): void {
  if (!shouldApply(options)) {
    throw new ConflictHandlingCancelledError();
  }
}

export async function handleConflicts(
  conflicts: Conflict[],
  options: ConflictHandlerOptions = {},
): Promise<void> {
  const db = getDb();
  const processedNoteIds = new Set<string>();

  try {
    for (const conflict of conflicts) {
      if (!shouldApply(options)) return;
      if (conflict.entityType !== "note") continue;
      if (processedNoteIds.has(conflict.entityId)) continue;

      processedNoteIds.add(conflict.entityId);

      const localNote = await db.notes.get(conflict.entityId);
      if (!shouldApply(options)) return;
      if (!localNote) continue;

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
        throwIfCancelled(options);
        const originalChanges = await db.pendingChanges
          .where("entityId")
          .equals(conflict.entityId)
          .filter((change) => change.entityType === "note")
          .toArray();

        throwIfCancelled(options);
        await db.notes.put(copy);
        throwIfCancelled(options);
        await queueChange(db, {
          entityType: "note",
          entityId: copy.id,
          operation: "create",
          baseRevision: 0,
        });
        throwIfCancelled(options);
        if (originalChanges.length > 0) {
          await db.pendingChanges
            .where("clientChangeId")
            .anyOf(originalChanges.map((change) => change.clientChangeId))
            .delete();
          throwIfCancelled(options);
        }
      });
      if (!shouldApply(options)) return;
      useNotesStore.getState().addConflictCopy(copy);
    }
  } catch (error) {
    if (error instanceof ConflictHandlingCancelledError) {
      return;
    }
    throw error;
  }
}
