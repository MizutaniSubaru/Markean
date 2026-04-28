import "fake-indexeddb/auto";

import type { NoteRecord } from "@markean/domain";
import { pushChanges } from "@markean/sync-core";
import { createWebDatabase, type MarkeanWebDatabase } from "@markean/storage-web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, initDb, resetDbForTests } from "../../src/features/notes/persistence/db";
import {
  createNote,
  deleteNote,
  getAllNotes,
  getNoteById,
  updateNote,
} from "../../src/features/notes/persistence/notes.persistence";

const note1: NoteRecord = {
  id: "note_1",
  folderId: "folder_1",
  title: "Test",
  bodyMd: "# Test",
  bodyPlain: "Test",
  currentRevision: 3,
  updatedAt: "2026-04-21T09:00:00.000Z",
  deletedAt: null,
};

const note2: NoteRecord = {
  id: "note_2",
  folderId: "folder_2",
  title: "Second",
  bodyMd: "Second",
  bodyPlain: "Second",
  currentRevision: 4,
  updatedAt: "2026-04-22T10:00:00.000Z",
  deletedAt: null,
};

describe("notes.persistence", () => {
  let db: MarkeanWebDatabase;

  beforeEach(() => {
    db = createWebDatabase(`test-notes-persistence-${crypto.randomUUID()}`);
    resetDbForTests();
    initDb(db);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.delete();
    resetDbForTests();
  });

  it("getDb throws before initDb is called", () => {
    resetDbForTests();

    expect(() => getDb()).toThrow("Database not initialized. Call initDb() first.");
  });

  it("creating a note writes it and queues a create change", async () => {
    await createNote(note1);

    expect(await db.notes.get("note_1")).toEqual(note1);
    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(1);
    const [change] = changes;
    expect(change).toMatchObject({
      entityType: "note",
      entityId: "note_1",
      operation: "create",
      baseRevision: 0,
    });
    expect(change.clientChangeId).toMatch(/^chg_/);
  });

  it("rolls back note creation when queueing the pending change fails", async () => {
    db.pendingChanges.hook("creating", () => {
      throw new Error("pending change failed");
    });

    await expect(createNote(note1)).rejects.toThrow("pending change failed");

    await expect(db.notes.toArray()).resolves.toEqual([]);
    await expect(db.pendingChanges.toArray()).resolves.toHaveLength(0);
  });

  it("reads all notes", async () => {
    await db.notes.bulkPut([note1, note2]);

    await expect(getAllNotes()).resolves.toEqual([note1, note2]);
  });

  it("reads a note by id", async () => {
    await db.notes.bulkPut([note1, note2]);

    await expect(getNoteById("note_2")).resolves.toEqual(note2);
    await expect(getNoteById("missing")).resolves.toBeUndefined();
  });

  it("updating a note writes changes, preserves unchanged fields, and queues an update change", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));
    await db.notes.put(note1);

    await expect(updateNote("note_1", { title: "Updated" })).resolves.toBe(true);

    await expect(db.notes.get("note_1")).resolves.toEqual({
      ...note1,
      title: "Updated",
      updatedAt: "2026-04-27T12:34:56.789Z",
    });
    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(1);
    const [change] = changes;
    expect(change).toMatchObject({
      entityType: "note",
      entityId: "note_1",
      operation: "update",
      baseRevision: 3,
    });
  });

  it("coalesces create then update into one create with the latest note payload", async () => {
    const note: NoteRecord = {
      id: "note_create_update",
      folderId: "folder_1",
      title: "Initial",
      bodyMd: "Initial body",
      bodyPlain: "Initial body",
      currentRevision: 0,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };

    await createNote(note);
    await updateNote(note.id, {
      title: "Edited",
      bodyMd: "Edited body",
      bodyPlain: "Edited body",
    });

    const pending = await db.pendingChanges.toArray();
    expect(pending).toMatchObject([
      {
        entityType: "note",
        entityId: note.id,
        operation: "create",
        baseRevision: 0,
      },
    ]);

    const pushedChanges: Parameters<Parameters<typeof pushChanges>[1]["syncPush"]>[0]["changes"][] = [];
    await pushChanges(
      db,
      {
        async syncPush(input) {
          pushedChanges.push(input.changes);
          return { accepted: [{ acceptedRevision: 1, cursor: 1 }], conflicts: [] };
        },
        async syncPull() {
          throw new Error("syncPull should not be called");
        },
      },
      "device_1",
    );

    expect(pushedChanges).toEqual([
      [
        {
          clientChangeId: expect.any(String),
          entityType: "note",
          entityId: note.id,
          operation: "create",
          baseRevision: 0,
          payload: {
            folderId: "folder_1",
            title: "Edited",
            bodyMd: "Edited body",
          },
        },
      ],
    ]);
  });

  it("coalesces repeated updates into one update with the original base revision and latest payload", async () => {
    await db.notes.put(note2);

    await updateNote(note2.id, {
      title: "First edit",
      bodyMd: "First body",
      bodyPlain: "First body",
    });
    await updateNote(note2.id, {
      title: "Second edit",
      bodyMd: "Second body",
      bodyPlain: "Second body",
    });

    const pending = await db.pendingChanges.toArray();
    expect(pending).toMatchObject([
      {
        entityType: "note",
        entityId: note2.id,
        operation: "update",
        baseRevision: 4,
      },
    ]);

    const pushedChanges: Parameters<Parameters<typeof pushChanges>[1]["syncPush"]>[0]["changes"][] = [];
    await pushChanges(
      db,
      {
        async syncPush(input) {
          pushedChanges.push(input.changes);
          return { accepted: [{ acceptedRevision: 5, cursor: 1 }], conflicts: [] };
        },
        async syncPull() {
          throw new Error("syncPull should not be called");
        },
      },
      "device_1",
    );

    expect(pushedChanges).toEqual([
      [
        {
          clientChangeId: expect.any(String),
          entityType: "note",
          entityId: note2.id,
          operation: "update",
          baseRevision: 4,
          payload: {
            folderId: "folder_2",
            title: "Second edit",
            bodyMd: "Second body",
          },
        },
      ],
    ]);
  });

  it("rolls back note updates when queueing the pending change fails", async () => {
    await db.notes.put(note1);
    db.pendingChanges.hook("creating", () => {
      throw new Error("pending change failed");
    });

    await expect(updateNote("note_1", { title: "Updated" })).rejects.toThrow(
      "pending change failed",
    );

    await expect(db.notes.get("note_1")).resolves.toEqual(note1);
    await expect(db.pendingChanges.toArray()).resolves.toHaveLength(0);
  });

  it("updating a missing note does nothing and queues no change", async () => {
    await expect(updateNote("missing", { title: "Ignored" })).resolves.toBe(false);

    await expect(db.notes.toArray()).resolves.toEqual([]);
    await expect(db.pendingChanges.toArray()).resolves.toEqual([]);
  });

  it("soft-deleting a note writes deletedAt and queues a delete change", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));
    await db.notes.put(note1);

    await deleteNote("note_1");

    await expect(db.notes.get("note_1")).resolves.toEqual({
      ...note1,
      deletedAt: "2026-04-27T12:34:56.789Z",
    });
    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(1);
    const [change] = changes;
    expect(change).toMatchObject({
      entityType: "note",
      entityId: "note_1",
      operation: "delete",
      baseRevision: 3,
    });
  });

  it("rolls back note deletion when queueing the pending change fails", async () => {
    await db.notes.put(note1);
    db.pendingChanges.hook("creating", () => {
      throw new Error("pending change failed");
    });

    await expect(deleteNote("note_1")).rejects.toThrow("pending change failed");

    await expect(db.notes.get("note_1")).resolves.toEqual(note1);
    await expect(db.pendingChanges.toArray()).resolves.toHaveLength(0);
  });

  it("deleting a missing note does nothing and queues no change", async () => {
    await deleteNote("missing");

    await expect(db.notes.toArray()).resolves.toEqual([]);
    await expect(db.pendingChanges.toArray()).resolves.toEqual([]);
  });
});
