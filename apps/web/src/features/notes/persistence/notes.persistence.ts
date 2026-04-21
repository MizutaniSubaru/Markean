import { markdownToPlainText } from "@markean/domain";
import type { NoteRecord } from "@markean/domain";
import { queueChange } from "@markean/sync-core";
import { getDb } from "./db";

export async function getAllNotes(): Promise<NoteRecord[]> {
  return getDb().notes.toArray();
}

export async function getNoteById(id: string): Promise<NoteRecord | undefined> {
  return getDb().notes.get(id);
}

export async function createNote(note: NoteRecord): Promise<void> {
  const db = getDb();
  await db.notes.put(note);
  await queueChange(db, {
    entityType: "note",
    entityId: note.id,
    operation: "create",
    baseRevision: 0,
  });
}

export async function updateNote(id: string, changes: Partial<NoteRecord>): Promise<void> {
  const db = getDb();
  const existing = await db.notes.get(id);

  if (!existing) {
    return;
  }

  const nextChanges: Partial<NoteRecord> = {
    ...changes,
    updatedAt: new Date().toISOString(),
  };

  if (changes.bodyMd !== undefined && changes.bodyPlain === undefined) {
    nextChanges.bodyPlain = markdownToPlainText(changes.bodyMd);
  }

  await db.notes.update(id, nextChanges);
  await queueChange(db, {
    entityType: "note",
    entityId: id,
    operation: "update",
    baseRevision: existing.currentRevision,
  });
}

export async function deleteNote(id: string): Promise<void> {
  const db = getDb();
  const existing = await db.notes.get(id);

  if (!existing) {
    return;
  }

  await db.notes.update(id, { deletedAt: new Date().toISOString() });
  await queueChange(db, {
    entityType: "note",
    entityId: id,
    operation: "delete",
    baseRevision: existing.currentRevision,
  });
}
