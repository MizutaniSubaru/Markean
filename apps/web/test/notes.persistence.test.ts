import "fake-indexeddb/auto";

import type { NoteRecord } from "@markean/domain";
import { createWebDatabase } from "@markean/storage-web";
import { pushChanges } from "@markean/sync-core";
import { afterEach, describe, expect, it } from "vitest";
import { initDb, resetDbForTests } from "../src/features/notes/persistence/db";
import { createNote, updateNote } from "../src/features/notes/persistence/notes.persistence";

function createNoteFixture(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: "note_1",
    folderId: "folder_1",
    title: "Initial",
    bodyMd: "Initial body",
    bodyPlain: "Initial body",
    currentRevision: 0,
    updatedAt: "2026-04-21T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("notes persistence sync queue", () => {
  afterEach(() => {
    resetDbForTests();
  });

  it("coalesces create then update into one create with the latest note payload", async () => {
    const db = createWebDatabase(`test-markean-note-create-update-${crypto.randomUUID()}`);
    initDb(db);
    const note = createNoteFixture();

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
    const db = createWebDatabase(`test-markean-note-repeated-update-${crypto.randomUUID()}`);
    initDb(db);
    const note = createNoteFixture({ currentRevision: 4 });
    await db.notes.put(note);

    await updateNote(note.id, {
      title: "First edit",
      bodyMd: "First body",
      bodyPlain: "First body",
    });
    await updateNote(note.id, {
      title: "Second edit",
      bodyMd: "Second body",
      bodyPlain: "Second body",
    });

    const pending = await db.pendingChanges.toArray();
    expect(pending).toMatchObject([
      {
        entityType: "note",
        entityId: note.id,
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
          entityId: note.id,
          operation: "update",
          baseRevision: 4,
          payload: {
            folderId: "folder_1",
            title: "Second edit",
            bodyMd: "Second body",
          },
        },
      ],
    ]);
  });
});
