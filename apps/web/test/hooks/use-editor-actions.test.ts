import "fake-indexeddb/auto";

import { renderHook, waitFor } from "@testing-library/react";
import type { NoteRecord } from "@markean/domain";
import { createWebDatabase, type MarkeanWebDatabase } from "@markean/storage-web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, initDb, resetDbForTests } from "../../src/features/notes/persistence/db";
import * as notesPersistence from "../../src/features/notes/persistence/notes.persistence";
import { useEditorActions } from "../../src/features/notes/hooks/useEditorActions";
import { useNotesStore } from "../../src/features/notes/store/notes.store";
import { useSyncStore } from "../../src/features/notes/store/sync.store";

const { schedulerState } = vi.hoisted(() => ({
  schedulerState: {
    scheduler: null as null | { requestSync: ReturnType<typeof vi.fn> },
  },
}));

vi.mock("../../src/app/bootstrap", () => ({
  getScheduler: () => schedulerState.scheduler,
}));

function note(overrides: Partial<NoteRecord> & Pick<NoteRecord, "id">): NoteRecord {
  return {
    folderId: "folder_1",
    title: "Original",
    bodyMd: "Original",
    bodyPlain: "Original",
    currentRevision: 7,
    updatedAt: "2026-04-20T12:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("useEditorActions", () => {
  let db: MarkeanWebDatabase;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-28T10:11:12.123Z"));
    db = createWebDatabase(`test-use-editor-actions-${crypto.randomUUID()}`);
    resetDbForTests();
    initDb(db);
    schedulerState.scheduler = null;
    useNotesStore.setState({ notes: [] });
    useSyncStore.setState({
      status: "idle",
      isOnline: true,
      lastSyncedAt: null,
      activeRunId: null,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await db.delete();
    resetDbForTests();
    schedulerState.scheduler = null;
    useNotesStore.setState({ notes: [] });
    useSyncStore.setState({
      status: "idle",
      isOnline: true,
      lastSyncedAt: null,
      activeRunId: null,
    });
  });

  it("updates the store title, body, bodyPlain and updatedAt optimistically", async () => {
    const existing = note({ id: "note_1" });
    await db.notes.put(existing);
    useNotesStore.getState().loadNotes([existing]);
    const { result } = renderHook(() => useEditorActions());

    await result.current.changeBody("note_1", "## New Title\n\nBody **text**");

    expect(useNotesStore.getState().notes[0]).toEqual({
      ...existing,
      title: "New Title",
      bodyMd: "## New Title\n\nBody **text**",
      bodyPlain: "New Title Body text",
      updatedAt: "2026-04-28T10:11:12.123Z",
    });
  });

  it("persists the note update and queues a pending update", async () => {
    const existing = note({ id: "note_1" });
    await db.notes.put(existing);
    useNotesStore.getState().loadNotes([existing]);
    const { result } = renderHook(() => useEditorActions());

    await result.current.changeBody("note_1", "# Persisted\nbody");

    await expect(getDb().notes.get("note_1")).resolves.toMatchObject({
      id: "note_1",
      title: "Persisted",
      bodyMd: "# Persisted\nbody",
      bodyPlain: "Persisted body",
      updatedAt: "2026-04-28T10:11:12.123Z",
    });
    const changes = await getDb().pendingChanges.toArray();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entityType: "note",
      entityId: "note_1",
      operation: "update",
      baseRevision: 7,
    });
  });

  it("marks sync unsynced and requests scheduler sync when a scheduler exists", async () => {
    const existing = note({ id: "note_1" });
    await db.notes.put(existing);
    useNotesStore.getState().loadNotes([existing]);
    schedulerState.scheduler = { requestSync: vi.fn() };
    const { result } = renderHook(() => useEditorActions());

    await result.current.changeBody("note_1", "# Sync me");

    expect(useSyncStore.getState().status).toBe("unsynced");
    expect(schedulerState.scheduler.requestSync).toHaveBeenCalledTimes(1);
  });

  it("does not require a scheduler to update and persist", async () => {
    const existing = note({ id: "note_1" });
    await db.notes.put(existing);
    useNotesStore.getState().loadNotes([existing]);
    const { result } = renderHook(() => useEditorActions());

    await result.current.changeBody("note_1", "# No Scheduler");

    await waitFor(() => {
      expect(useNotesStore.getState().notes[0].title).toBe("No Scheduler");
    });
    await expect(getDb().notes.get("note_1")).resolves.toMatchObject({
      title: "No Scheduler",
    });
  });

  it("uses an empty title for blank body content", async () => {
    const existing = note({ id: "note_1", title: "Was titled" });
    await db.notes.put(existing);
    useNotesStore.getState().loadNotes([existing]);
    const { result } = renderHook(() => useEditorActions());

    await result.current.changeBody("note_1", " \n\t ");

    expect(useNotesStore.getState().notes[0]).toMatchObject({
      title: "",
      bodyMd: " \n\t ",
      bodyPlain: "",
    });
    await expect(getDb().notes.get("note_1")).resolves.toMatchObject({
      title: "",
      bodyMd: " \n\t ",
      bodyPlain: "",
    });
  });

  it("does nothing for a missing note without sync side effects", async () => {
    schedulerState.scheduler = { requestSync: vi.fn() };
    const { result } = renderHook(() => useEditorActions());

    await result.current.changeBody("missing", "# ghost");

    expect(useNotesStore.getState().notes).toEqual([]);
    await expect(getDb().notes.toArray()).resolves.toEqual([]);
    await expect(getDb().pendingChanges.toArray()).resolves.toEqual([]);
    expect(useSyncStore.getState().status).toBe("idle");
    expect(schedulerState.scheduler.requestSync).not.toHaveBeenCalled();
  });

  it("restores the store and skips sync when the note exists in store but is missing from DB", async () => {
    const existing = note({ id: "note_1" });
    useNotesStore.getState().loadNotes([existing]);
    schedulerState.scheduler = { requestSync: vi.fn() };
    const { result } = renderHook(() => useEditorActions());

    await result.current.changeBody("note_1", "# Missing DB row");

    expect(useNotesStore.getState().notes).toEqual([existing]);
    await expect(getDb().notes.get("note_1")).resolves.toBeUndefined();
    await expect(getDb().pendingChanges.toArray()).resolves.toEqual([]);
    expect(useSyncStore.getState().status).toBe("idle");
    expect(schedulerState.scheduler.requestSync).not.toHaveBeenCalled();
  });

  it("rolls back the optimistic store update when persistence fails", async () => {
    const existing = note({ id: "note_1" });
    await db.notes.put(existing);
    db.pendingChanges.hook("creating", () => {
      throw new Error("pending change failed");
    });
    useNotesStore.getState().loadNotes([existing]);
    schedulerState.scheduler = { requestSync: vi.fn() };
    const { result } = renderHook(() => useEditorActions());

    await expect(result.current.changeBody("note_1", "# Failed\nbody")).rejects.toThrow(
      "pending change failed",
    );

    expect(useNotesStore.getState().notes).toEqual([existing]);
    await expect(getDb().notes.get("note_1")).resolves.toEqual(existing);
    await expect(getDb().pendingChanges.toArray()).resolves.toEqual([]);
    expect(useSyncStore.getState().status).toBe("idle");
    expect(schedulerState.scheduler.requestSync).not.toHaveBeenCalled();
  });

  it("does not roll back over a newer optimistic edit when an earlier persistence fails", async () => {
    const existing = note({ id: "note_1" });
    await db.notes.put(existing);
    useNotesStore.getState().loadNotes([existing]);
    schedulerState.scheduler = { requestSync: vi.fn() };
    const firstPersistence = deferred<boolean>();
    let calls = 0;
    vi.spyOn(notesPersistence, "updateNote").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return firstPersistence.promise;
      return true;
    });
    const { result } = renderHook(() => useEditorActions());

    const firstChange = result.current.changeBody("note_1", "# First");
    expect(useNotesStore.getState().notes[0]).toMatchObject({
      title: "First",
      bodyMd: "# First",
      bodyPlain: "First",
    });

    await result.current.changeBody("note_1", "# Second");
    expect(useNotesStore.getState().notes[0]).toMatchObject({
      title: "Second",
      bodyMd: "# Second",
      bodyPlain: "Second",
    });

    firstPersistence.reject(new Error("first persistence failed"));
    await expect(firstChange).rejects.toThrow("first persistence failed");

    expect(useNotesStore.getState().notes[0]).toMatchObject({
      title: "Second",
      bodyMd: "# Second",
      bodyPlain: "Second",
    });
    expect(useSyncStore.getState().status).toBe("unsynced");
    expect(schedulerState.scheduler.requestSync).toHaveBeenCalledTimes(1);
  });
});
