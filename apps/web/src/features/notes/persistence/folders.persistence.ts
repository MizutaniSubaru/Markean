import type { FolderRecord } from "@markean/domain";
import { queueChange } from "@markean/sync-core";
import { getDb } from "./db";

export async function getAllFolders(): Promise<FolderRecord[]> {
  return getDb().folders.toArray();
}

export async function createFolder(folder: FolderRecord): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.folders, db.pendingChanges, async () => {
    await db.folders.put(folder);
    await queueChange(db, {
      entityType: "folder",
      entityId: folder.id,
      operation: "create",
      baseRevision: 0,
    });
  });
}

export async function deleteFolder(id: string): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.folders, db.notes, db.pendingChanges, async () => {
    const existing = await db.folders.get(id);
    if (!existing) return;

    const deletedAt = new Date().toISOString();
    const childNotes = await db.notes.where("folderId").equals(id).toArray();
    const pendingChanges = await db.pendingChanges.toArray();
    for (const note of childNotes) {
      if (note.deletedAt !== null) continue;
      await db.notes.update(note.id, { deletedAt });
      const childHasPendingChange = pendingChanges.some(
        (change) => change.entityType === "note" && change.entityId === note.id,
      );
      if (note.currentRevision > 1 || childHasPendingChange) {
        await queueChange(db, {
          entityType: "note",
          entityId: note.id,
          operation: "delete",
          baseRevision: note.currentRevision,
        });
      }
    }

    await db.folders.update(id, { deletedAt });
    await queueChange(db, {
      entityType: "folder",
      entityId: id,
      operation: "delete",
      baseRevision: existing.currentRevision,
    });
  });
}
