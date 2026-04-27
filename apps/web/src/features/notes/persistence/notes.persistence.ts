import type { NoteRecord } from "@markean/domain";
import { queueChange } from "@markean/sync-core";
import { getDb } from "./db";

type NoteUpdateChanges = Partial<Pick<NoteRecord, "folderId" | "title" | "bodyMd" | "bodyPlain">>;

export async function getAllNotes(): Promise<NoteRecord[]> {
  return getDb().notes.toArray();
}

export async function getNoteById(id: string): Promise<NoteRecord | undefined> {
  return getDb().notes.get(id);
}

export async function createNote(note: NoteRecord): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.notes, db.pendingChanges, async () => {
    await db.notes.put(note);
    await queueChange(db, {
      entityType: "note",
      entityId: note.id,
      operation: "create",
      baseRevision: 0,
    });
  });
}

export async function updateNote(
  id: string,
  changes: NoteUpdateChanges,
): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.notes, db.pendingChanges, async () => {
    const existing = await db.notes.get(id);
    if (!existing) return;

    await db.notes.update(id, { ...changes, updatedAt: new Date().toISOString() });
    await queueChange(db, {
      entityType: "note",
      entityId: id,
      operation: "update",
      baseRevision: existing.currentRevision,
    });
  });
}

export async function deleteNote(id: string): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.notes, db.pendingChanges, async () => {
    const existing = await db.notes.get(id);
    if (!existing) return;

    await db.notes.update(id, { deletedAt: new Date().toISOString() });
    await queueChange(db, {
      entityType: "note",
      entityId: id,
      operation: "delete",
      baseRevision: existing.currentRevision,
    });
  });
}
