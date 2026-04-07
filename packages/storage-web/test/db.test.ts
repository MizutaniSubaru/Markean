import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";
import { queueNoteUpdate } from "../../sync-core/src/index";
import { createWebDatabase } from "../src/index";

describe("web storage adapter", () => {
  it("stores a note and a pending change in one transaction", async () => {
    const db = createWebDatabase("test-markean");

    await queueNoteUpdate(db, {
      noteId: "note_1",
      folderId: "folder_1",
      title: "Draft",
      bodyMd: "Hello",
    });

    const notes = await db.notes.toArray();
    const changes = await db.pendingChanges.toArray();

    expect(notes).toHaveLength(1);
    expect(changes).toHaveLength(1);
  });

  it("rolls back the note write if the pending change write fails", async () => {
    const db = createWebDatabase("test-markean-rollback");

    db.pendingChanges.hook("creating", () => {
      throw new Error("pending change failed");
    });

    await expect(
      queueNoteUpdate(db, {
        noteId: "note_rollback",
        folderId: "folder_1",
        title: "Rollback",
        bodyMd: "Hello",
      }),
    ).rejects.toThrow("pending change failed");

    expect(await db.notes.toArray()).toHaveLength(0);
    expect(await db.pendingChanges.toArray()).toHaveLength(0);
  });
});
