import "fake-indexeddb/auto";

import type { NoteRecord } from "@markean/domain";
import { createWebDatabase, type MarkeanWebDatabase } from "@markean/storage-web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initDb, resetDbForTests } from "../../src/features/notes/persistence/db";
import { handleConflicts } from "../../src/features/notes/sync/conflict.handler";
import { useNotesStore } from "../../src/features/notes/store/notes.store";

const note1: NoteRecord = {
  id: "note_1",
  folderId: "folder_1",
  title: "Local edit",
  bodyMd: "# Local",
  bodyPlain: "Local",
  currentRevision: 1,
  updatedAt: "2026-04-21T09:00:00.000Z",
  deletedAt: null,
};

const note2: NoteRecord = {
  id: "note_2",
  folderId: "folder_2",
  title: "Second local edit",
  bodyMd: "Second",
  bodyPlain: "Second",
  currentRevision: 2,
  updatedAt: "2026-04-22T09:00:00.000Z",
  deletedAt: "2026-04-23T09:00:00.000Z",
};

describe("conflict.handler", () => {
  let db: MarkeanWebDatabase;

  async function seedPendingNoteChange(entityId: string): Promise<void> {
    await db.pendingChanges.put({
      clientChangeId: `chg_original_${entityId}`,
      entityType: "note",
      entityId,
      operation: "update",
      baseRevision: 1,
    });
  }

  beforeEach(() => {
    db = createWebDatabase(`test-conflict-${crypto.randomUUID()}`);
    resetDbForTests();
    initDb(db);
    useNotesStore.setState({ notes: [] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    useNotesStore.setState({ notes: [] });
    await db.delete();
    resetDbForTests();
  });

  it("creates a conflict copy for a conflicting note", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));
    await db.notes.put(note1);
    useNotesStore.getState().loadNotes([note1]);

    await handleConflicts([
      { entityType: "note", entityId: "note_1", serverRevision: 5 },
    ]);

    const storeNotes = useNotesStore.getState().notes;
    expect(storeNotes).toHaveLength(2);
    expect(storeNotes.find((n) => n.id === "note_1")).toEqual(note1);

    const copy = storeNotes.find((n) => n.id !== "note_1");
    expect(copy).toBeDefined();
    expect(copy).toMatchObject({
      folderId: note1.folderId,
      title: "Local edit (conflict copy)",
      bodyMd: note1.bodyMd,
      bodyPlain: note1.bodyPlain,
      currentRevision: 0,
      updatedAt: "2026-04-27T12:34:56.789Z",
      deletedAt: null,
    });
    expect(copy!.id).toMatch(/^note_/);
    expect(copy!.id).not.toBe(note1.id);

    await expect(db.notes.get(copy!.id)).resolves.toEqual(copy);

    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entityType: "note",
      entityId: copy!.id,
      operation: "create",
      baseRevision: 0,
    });
    expect(changes[0].clientChangeId).toMatch(/^chg_/);
  });

  it("skips conflicts for non-note entity types", async () => {
    await handleConflicts([
      { entityType: "folder", entityId: "folder_1", serverRevision: 3 },
    ]);

    expect(useNotesStore.getState().notes).toHaveLength(0);
    await expect(db.pendingChanges.toArray()).resolves.toEqual([]);
  });

  it("skips conflicts for missing local notes", async () => {
    await handleConflicts([
      { entityType: "note", entityId: "missing", serverRevision: 3 },
    ]);

    expect(useNotesStore.getState().notes).toHaveLength(0);
    await expect(db.pendingChanges.toArray()).resolves.toEqual([]);
  });

  it("creates conflict copies for multiple note conflicts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));
    await db.notes.bulkPut([note1, note2]);
    await seedPendingNoteChange("note_1");
    await seedPendingNoteChange("note_2");
    useNotesStore.getState().loadNotes([note1, note2]);

    await handleConflicts([
      { entityType: "note", entityId: "note_1", serverRevision: 5 },
      { entityType: "note", entityId: "note_2", serverRevision: 6 },
    ]);

    const storeNotes = useNotesStore.getState().notes;
    const copies = storeNotes.filter((n) => n.id !== "note_1" && n.id !== "note_2");
    expect(storeNotes).toHaveLength(4);
    expect(copies).toHaveLength(2);
    expect(copies.map((copy) => copy.title).sort()).toEqual([
      "Local edit (conflict copy)",
      "Second local edit (conflict copy)",
    ]);
    expect(copies.every((copy) => copy.currentRevision === 0)).toBe(true);
    expect(copies.every((copy) => copy.updatedAt === "2026-04-27T12:34:56.789Z")).toBe(
      true,
    );
    expect(
      copies.find((copy) => copy.title === "Second local edit (conflict copy)"),
    ).toMatchObject({
      folderId: note2.folderId,
      bodyMd: note2.bodyMd,
      bodyPlain: note2.bodyPlain,
      deletedAt: null,
    });

    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(2);
    expect(changes.map((change) => change.entityId).sort()).toEqual(
      copies.map((copy) => copy.id).sort(),
    );
    expect(changes.every((change) => change.operation === "create")).toBe(true);
    expect(changes.every((change) => change.baseRevision === 0)).toBe(true);
  });

  it("deduplicates duplicate note conflicts", async () => {
    await db.notes.put(note1);
    await seedPendingNoteChange("note_1");
    useNotesStore.getState().loadNotes([note1]);

    await handleConflicts([
      { entityType: "note", entityId: "note_1", serverRevision: 5 },
      { entityType: "note", entityId: "note_1", serverRevision: 5 },
    ]);

    const storeNotes = useNotesStore.getState().notes;
    const copies = storeNotes.filter((n) => n.id !== "note_1");
    expect(storeNotes).toHaveLength(2);
    expect(copies).toHaveLength(1);

    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entityType: "note",
      entityId: copies[0].id,
      operation: "create",
      baseRevision: 0,
    });
  });

  it("removes original pending note changes after creating a conflict copy", async () => {
    await db.notes.put(note1);
    useNotesStore.getState().loadNotes([note1]);
    await db.pendingChanges.bulkPut([
      {
        clientChangeId: "chg_original_note_1_a",
        entityType: "note",
        entityId: "note_1",
        operation: "update",
        baseRevision: 1,
      },
      {
        clientChangeId: "chg_original_note_1_b",
        entityType: "note",
        entityId: "note_1",
        operation: "update",
        baseRevision: 2,
      },
      {
        clientChangeId: "chg_original_folder_same_id",
        entityType: "folder",
        entityId: "note_1",
        operation: "update",
        baseRevision: 1,
      },
    ]);

    await handleConflicts([
      { entityType: "note", entityId: "note_1", serverRevision: 5 },
    ]);

    const copy = useNotesStore.getState().notes.find((n) => n.id !== "note_1");
    expect(copy).toBeDefined();

    const changes = await db.pendingChanges.orderBy("clientChangeId").toArray();
    expect(changes).toHaveLength(2);
    expect(changes).toContainEqual({
      clientChangeId: "chg_original_folder_same_id",
      entityType: "folder",
      entityId: "note_1",
      operation: "update",
      baseRevision: 1,
    });
    expect(changes.some((change) => change.clientChangeId === "chg_original_note_1_a")).toBe(
      false,
    );
    expect(changes.some((change) => change.clientChangeId === "chg_original_note_1_b")).toBe(
      false,
    );
    expect(changes.find((change) => change.entityId === copy!.id)).toMatchObject({
      entityType: "note",
      entityId: copy!.id,
      operation: "create",
      baseRevision: 0,
    });
  });

  it("removes the original pending change so the next sync will not retry it", async () => {
    await db.notes.put(note1);
    useNotesStore.getState().loadNotes([note1]);
    await seedPendingNoteChange("note_1");

    await handleConflicts([
      { entityType: "note", entityId: "note_1", serverRevision: 5 },
    ]);

    const storeNotes = useNotesStore.getState().notes;
    const copies = storeNotes.filter((n) => n.id !== "note_1");
    expect(storeNotes).toHaveLength(2);
    expect(copies).toHaveLength(1);

    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(1);
    expect(changes[0].entityId).toBe(copies[0].id);
    expect(changes.some((change) => change.entityId === "note_1")).toBe(false);
  });

  it("skips conflict copy writes when shouldApply becomes false before mutation", async () => {
    await db.notes.put(note1);
    useNotesStore.getState().loadNotes([note1]);
    await seedPendingNoteChange("note_1");
    let checks = 0;

    await handleConflicts(
      [{ entityType: "note", entityId: "note_1", serverRevision: 5 }],
      {
        shouldApply: () => {
          checks += 1;
          return checks === 1;
        },
      },
    );

    expect(useNotesStore.getState().notes).toEqual([note1]);
    await expect(db.notes.toArray()).resolves.toEqual([note1]);
    await expect(db.pendingChanges.toArray()).resolves.toEqual([
      {
        clientChangeId: "chg_original_note_1",
        entityType: "note",
        entityId: "note_1",
        operation: "update",
        baseRevision: 1,
      },
    ]);
  });

  it("rolls back conflict copy writes when shouldApply becomes false during mutation", async () => {
    await db.notes.put(note1);
    useNotesStore.getState().loadNotes([note1]);
    await seedPendingNoteChange("note_1");
    let checks = 0;

    await handleConflicts(
      [{ entityType: "note", entityId: "note_1", serverRevision: 5 }],
      {
        shouldApply: () => {
          checks += 1;
          return checks < 5;
        },
      },
    );

    expect(useNotesStore.getState().notes).toEqual([note1]);
    await expect(db.notes.toArray()).resolves.toEqual([note1]);
    await expect(db.pendingChanges.toArray()).resolves.toEqual([
      {
        clientChangeId: "chg_original_note_1",
        entityType: "note",
        entityId: "note_1",
        operation: "update",
        baseRevision: 1,
      },
    ]);
  });

  it("does not update the store or leave a copy when creating the copy fails", async () => {
    await db.notes.put(note1);
    useNotesStore.getState().loadNotes([note1]);
    await seedPendingNoteChange("note_1");
    db.pendingChanges.hook("creating", () => {
      throw new Error("pending change failed");
    });

    await expect(
      handleConflicts([{ entityType: "note", entityId: "note_1", serverRevision: 5 }]),
    ).rejects.toThrow("pending change failed");

    expect(useNotesStore.getState().notes).toEqual([note1]);
    await expect(db.notes.get("note_1")).resolves.toEqual(note1);
    await expect(db.notes.toArray()).resolves.toEqual([note1]);
    await expect(db.pendingChanges.toArray()).resolves.toEqual([
      {
        clientChangeId: "chg_original_note_1",
        entityType: "note",
        entityId: "note_1",
        operation: "update",
        baseRevision: 1,
      },
    ]);
  });

  it("rolls back the conflict copy when original pending cleanup fails", async () => {
    await db.notes.put(note1);
    useNotesStore.getState().loadNotes([note1]);
    await seedPendingNoteChange("note_1");
    db.pendingChanges.hook("deleting", (clientChangeId) => {
      if (clientChangeId === "chg_original_note_1") {
        throw new Error("cleanup failed");
      }
    });

    await expect(
      handleConflicts([{ entityType: "note", entityId: "note_1", serverRevision: 5 }]),
    ).rejects.toThrow("cleanup failed");

    expect(useNotesStore.getState().notes).toEqual([note1]);
    await expect(db.notes.toArray()).resolves.toEqual([note1]);
    await expect(db.pendingChanges.toArray()).resolves.toEqual([
      {
        clientChangeId: "chg_original_note_1",
        entityType: "note",
        entityId: "note_1",
        operation: "update",
        baseRevision: 1,
      },
    ]);
  });
});
