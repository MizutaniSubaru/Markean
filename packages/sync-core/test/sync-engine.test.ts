import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";
import { createWebDatabase } from "../../storage-web/src/index";
import { queueNoteUpdate, reconcilePushResult } from "../src/index";

describe("sync engine queue", () => {
  it("creates a note and pending change from the shared domain helpers", async () => {
    const db = createWebDatabase("test-markean-sync");

    await queueNoteUpdate(db, {
      noteId: "note_1",
      folderId: "folder_1",
      title: "Draft",
      bodyMd: "# Draft\n\nHello world",
    });

    const [note] = await db.notes.toArray();
    const [change] = await db.pendingChanges.toArray();

    expect(note?.bodyPlain).toBe("Draft Hello world");
    expect(note?.currentRevision).toBe(1);
    expect(change?.entityType).toBe("note");
    expect(change?.entityId).toBe("note_1");
    expect(change?.baseRevision).toBe(1);
  });

  it("creates a conflicted copy when the server rejects a stale revision", () => {
    const result = reconcilePushResult({
      accepted: [],
      conflicts: [
        {
          entityId: "note_1",
          serverRevision: 4,
          localTitle: "Draft",
          localBodyMd: "Stale edit",
        },
      ],
    });

    expect(result.conflictedCopies).toHaveLength(1);
    expect(result.conflictedCopies[0]?.title).toContain("Conflicted Copy");
  });
});
