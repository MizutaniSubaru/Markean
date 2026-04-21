import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebDatabase } from "@markean/storage-web";
import type { MarkeanWebDatabase } from "@markean/storage-web";
import type { NoteRecord } from "@markean/domain";
import { initDb } from "../../src/features/notes/persistence/db";
import {
  createNote,
  deleteNote,
  getAllNotes,
  getNoteById,
  updateNote,
} from "../../src/features/notes/persistence/notes.persistence";

describe("notes.persistence", () => {
  let db: MarkeanWebDatabase;

  const note: NoteRecord = {
    id: "note_1",
    folderId: "folder_1",
    title: "Test",
    bodyMd: "# Test",
    bodyPlain: "Test",
    currentRevision: 0,
    updatedAt: "2026-04-21T09:00:00.000Z",
    deletedAt: null,
  };

  beforeEach(() => {
    db = createWebDatabase(`test-persistence-${crypto.randomUUID()}`);
    initDb(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  it("creates a note and queues a pending change", async () => {
    await createNote(note);

    const stored = await db.notes.get("note_1");
    expect(stored).toMatchObject({ id: "note_1", title: "Test" });

    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entityType: "note",
      entityId: "note_1",
      operation: "create",
      baseRevision: 0,
    });
  });

  it("reads all notes", async () => {
    await createNote(note);
    const all = await getAllNotes();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("note_1");
  });

  it("reads a note by id", async () => {
    await createNote(note);
    const found = await getNoteById("note_1");
    expect(found?.id).toBe("note_1");
  });

  it("updates a note and queues a pending change", async () => {
    await createNote({ ...note, currentRevision: 2 });
    await updateNote("note_1", { bodyMd: "# Updated" });

    const stored = await db.notes.get("note_1");
    expect(stored?.bodyMd).toBe("# Updated");
    expect(stored?.bodyPlain).toBe("Updated");

    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(2);
    const updateChange = changes.find((change) => change.operation === "update");
    expect(updateChange).toMatchObject({
      entityType: "note",
      operation: "update",
      baseRevision: 2,
    });
  });

  it("soft-deletes a note and queues a pending change", async () => {
    await createNote(note);
    await deleteNote("note_1");

    const stored = await db.notes.get("note_1");
    expect(stored?.deletedAt).not.toBeNull();

    const changes = await db.pendingChanges.toArray();
    const deleteChange = changes.find((change) => change.operation === "delete");
    expect(deleteChange).toMatchObject({
      entityType: "note",
      entityId: "note_1",
      operation: "delete",
    });
  });
});
