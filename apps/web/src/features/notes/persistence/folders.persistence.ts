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
  await db.transaction("rw", db.folders, db.pendingChanges, async () => {
    const existing = await db.folders.get(id);
    if (!existing) return;

    await db.folders.update(id, { deletedAt: new Date().toISOString() });
    await queueChange(db, {
      entityType: "folder",
      entityId: id,
      operation: "delete",
      baseRevision: existing.currentRevision,
    });
  });
}
