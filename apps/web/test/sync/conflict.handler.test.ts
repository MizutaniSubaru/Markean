import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebDatabase } from "@markean/storage-web";
import type { MarkeanWebDatabase } from "@markean/storage-web";
import type { NoteRecord } from "@markean/domain";
import { initDb } from "../../src/features/notes/persistence/db";
import { useNotesStore } from "../../src/features/notes/store/notes.store";
import { handleConflicts } from "../../src/features/notes/sync/conflict.handler";

describe("conflict.handler", () => {
  let db: MarkeanWebDatabase;

  beforeEach(() => {
    db = createWebDatabase(`test-conflict-${crypto.randomUUID()}`);
    initDb(db);
    useNotesStore.setState({ notes: [] });
  });

  afterEach(async () => {
    useNotesStore.setState({ notes: [] });
    await db.delete();
  });

  it("creates a conflict copy for a conflicting note", async () => {
    const note: NoteRecord = {
      id: "note_1",
      folderId: "folder_1",
      title: "Local edit",
      bodyMd: "# Local",
      bodyPlain: "Local",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };

    await db.notes.put(note);
    useNotesStore.getState().loadNotes([note]);

    await handleConflicts([
      { entityType: "note", entityId: "note_1", serverRevision: 5 },
    ]);

    const storeNotes = useNotesStore.getState().notes;
    expect(storeNotes).toHaveLength(2);

    const copy = storeNotes.find((candidate) => candidate.id !== "note_1");
    expect(copy).toBeDefined();
    expect(copy?.title).toContain("(conflict copy)");
    expect(copy?.bodyMd).toBe("# Local");

    const dbCopy = await db.notes.get(copy!.id);
    expect(dbCopy).toBeDefined();
  });

  it("skips conflicts for non-note entity types", async () => {
    await handleConflicts([
      { entityType: "folder", entityId: "folder_1", serverRevision: 3 },
    ]);

    expect(useNotesStore.getState().notes).toHaveLength(0);
  });

  it("skips note conflicts when the local note is missing", async () => {
    await handleConflicts([
      { entityType: "note", entityId: "missing", serverRevision: 3 },
    ]);

    expect(useNotesStore.getState().notes).toHaveLength(0);
    await expect(db.notes.toArray()).resolves.toHaveLength(0);
  });
});
