import "fake-indexeddb/auto";

import type { FolderRecord, NoteRecord } from "@markean/domain";
import { queueChange } from "@markean/sync-core";
import { createWebDatabase, type MarkeanWebDatabase } from "@markean/storage-web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDb,
  initDb,
  resetDbForTests,
} from "../src/features/notes/persistence/db";
import { useEditorStore } from "../src/features/notes/store/editor.store";
import { useFoldersStore } from "../src/features/notes/store/folders.store";
import { useNotesStore } from "../src/features/notes/store/notes.store";
import { useSyncStore } from "../src/features/notes/store/sync.store";
import {
  bootstrapApp,
  getScheduler,
  migrateFromLocalStorage,
  resetSchedulerForTests,
} from "../src/app/bootstrap";

function installStorageMock() {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
    get length() {
      return store.size;
    },
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  return { storage, store };
}

function resetStores(): void {
  useNotesStore.setState({ notes: [] });
  useFoldersStore.setState({ folders: [] });
  useEditorStore.setState({
    activeFolderId: "",
    activeNoteId: "",
    searchQuery: "",
    mobileView: "folders",
    newNoteId: null,
  });
  useSyncStore.setState({
    status: "idle",
    isOnline: true,
    lastSyncedAt: null,
  });
}

describe("migrateFromLocalStorage", () => {
  let db: MarkeanWebDatabase;

  beforeEach(() => {
    db = createWebDatabase(`test-bootstrap-${crypto.randomUUID()}`);
    resetDbForTests();
    initDb(db);
    resetStores();
  });

  afterEach(async () => {
    await db.delete();
    resetDbForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("migrates workspace snapshot from localStorage to IndexedDB", async () => {
    const { storage, store } = installStorageMock();
    store.set(
      "markean:workspace",
      JSON.stringify({
        folders: [{ id: "notes", name: "Notes" }],
        notes: [
          {
            id: "note_1",
            folderId: "notes",
            title: "Hello",
            body: "# Hello\n\nWorld",
            updatedAt: "2026-04-21T09:00:00.000Z",
          },
        ],
        activeFolderId: "notes",
        activeNoteId: "note_1",
      }),
    );
    store.set("markean:draft:note_1", "# Hello\n\nWorld (draft)");
    store.set("markean:draft:orphan", "Orphan draft");
    store.set("markean:sync-status", "unsynced");

    await migrateFromLocalStorage();

    const notes = await db.notes.toArray();
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe("note_1");
    expect(notes[0].bodyMd).toBe("# Hello\n\nWorld (draft)");
    expect(notes[0].bodyPlain).toBeTruthy();
    expect(notes[0].currentRevision).toBe(0);

    const folders = await db.folders.toArray();
    expect(folders).toHaveLength(1);
    expect(folders[0].id).toBe("notes");

    const pendingChanges = await db.pendingChanges.toArray();
    expect(pendingChanges).toHaveLength(2);
    expect(pendingChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "folder",
          entityId: "notes",
          operation: "create",
          baseRevision: 0,
        }),
        expect.objectContaining({
          entityType: "note",
          entityId: "note_1",
          operation: "create",
          baseRevision: 0,
        }),
      ]),
    );

    expect(storage.removeItem).toHaveBeenCalledWith("markean:workspace");
    expect(storage.removeItem).toHaveBeenCalledWith("markean:draft:note_1");
    expect(storage.removeItem).toHaveBeenCalledWith("markean:draft:orphan");
    expect(storage.removeItem).toHaveBeenCalledWith("markean:sync-status");
    expect(Array.from(store.keys()).some((key) => key.startsWith("markean:draft:"))).toBe(false);
  });

  it("skips migration when IndexedDB already has data", async () => {
    const { store } = installStorageMock();
    store.set(
      "markean:workspace",
      JSON.stringify({
        folders: [{ id: "notes", name: "Notes" }],
        notes: [],
        activeFolderId: "notes",
        activeNoteId: "",
      }),
    );

    await db.folders.put({
      id: "existing",
      name: "Existing",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    });

    await migrateFromLocalStorage();

    const folders = await db.folders.toArray();
    expect(folders).toHaveLength(1);
    expect(folders[0].id).toBe("existing");
  });

  it("skips migration when no localStorage data", async () => {
    installStorageMock();
    await migrateFromLocalStorage();

    const notes = await db.notes.toArray();
    const folders = await db.folders.toArray();
    expect(notes).toHaveLength(0);
    expect(folders).toHaveLength(0);
  });

  it("leaves invalid localStorage snapshots untouched", async () => {
    const { storage, store } = installStorageMock();
    store.set("markean:workspace", "{not-valid-json");

    await migrateFromLocalStorage();

    expect(await db.notes.toArray()).toEqual([]);
    expect(await db.folders.toArray()).toEqual([]);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["wrong shape", { folders: {}, notes: [] }],
    [
      "missing active folder",
      {
        folders: [{ id: "notes", name: "Notes" }],
        notes: [],
        activeNoteId: "",
      },
    ],
    [
      "mistyped active note",
      {
        folders: [{ id: "notes", name: "Notes" }],
        notes: [],
        activeFolderId: "notes",
        activeNoteId: null,
      },
    ],
  ])("leaves valid JSON with invalid workspace shape untouched: %s", async (_name, payload) => {
    const { storage, store } = installStorageMock();
    store.set("markean:workspace", JSON.stringify(payload));

    await migrateFromLocalStorage();

    expect(await db.notes.toArray()).toEqual([]);
    expect(await db.folders.toArray()).toEqual([]);
    expect(await db.pendingChanges.toArray()).toEqual([]);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([
    [
      "malformed folder",
      {
        folders: [{ id: 123, name: "Notes" }],
        notes: [],
        activeFolderId: "notes",
        activeNoteId: "",
      },
    ],
    [
      "malformed note",
      {
        folders: [{ id: "notes", name: "Notes" }],
        notes: [
          {
            id: "note_1",
            folderId: "notes",
            title: "Hello",
            body: null,
            updatedAt: "2026-04-21T09:00:00.000Z",
          },
        ],
        activeFolderId: "notes",
        activeNoteId: "note_1",
      },
    ],
  ])("leaves malformed workspace entries untouched: %s", async (_name, payload) => {
    const { storage, store } = installStorageMock();
    store.set("markean:workspace", JSON.stringify(payload));

    await migrateFromLocalStorage();

    expect(await db.notes.toArray()).toEqual([]);
    expect(await db.folders.toArray()).toEqual([]);
    expect(await db.pendingChanges.toArray()).toEqual([]);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([
    [
      "dangling active folder",
      {
        folders: [{ id: "notes", name: "Notes" }],
        notes: [],
        activeFolderId: "missing",
        activeNoteId: "",
      },
    ],
    [
      "dangling active note",
      {
        folders: [{ id: "notes", name: "Notes" }],
        notes: [],
        activeFolderId: "notes",
        activeNoteId: "missing",
      },
    ],
    [
      "note folder missing",
      {
        folders: [{ id: "notes", name: "Notes" }],
        notes: [
          {
            id: "note_1",
            folderId: "missing",
            title: "Hello",
            body: "# Hello",
            updatedAt: "2026-04-21T09:00:00.000Z",
          },
        ],
        activeFolderId: "notes",
        activeNoteId: "note_1",
      },
    ],
    [
      "active note outside active folder",
      {
        folders: [
          { id: "notes", name: "Notes" },
          { id: "archive", name: "Archive" },
        ],
        notes: [
          {
            id: "note_1",
            folderId: "archive",
            title: "Hello",
            body: "# Hello",
            updatedAt: "2026-04-21T09:00:00.000Z",
          },
        ],
        activeFolderId: "notes",
        activeNoteId: "note_1",
      },
    ],
  ])("leaves workspace with dangling references untouched: %s", async (_name, payload) => {
    const { storage, store } = installStorageMock();
    store.set("markean:workspace", JSON.stringify(payload));

    await migrateFromLocalStorage();

    expect(await db.notes.toArray()).toEqual([]);
    expect(await db.folders.toArray()).toEqual([]);
    expect(await db.pendingChanges.toArray()).toEqual([]);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("allows empty active ids when records otherwise reference existing folders", async () => {
    const { storage, store } = installStorageMock();
    store.set(
      "markean:workspace",
      JSON.stringify({
        folders: [{ id: "notes", name: "Notes" }],
        notes: [
          {
            id: "note_1",
            folderId: "notes",
            title: "Hello",
            body: "# Hello",
            updatedAt: "2026-04-21T09:00:00.000Z",
          },
        ],
        activeFolderId: "",
        activeNoteId: "",
      }),
    );

    await migrateFromLocalStorage();

    expect(await db.folders.toArray()).toHaveLength(1);
    expect(await db.notes.toArray()).toHaveLength(1);
    expect(await db.pendingChanges.toArray()).toHaveLength(2);
    expect(storage.removeItem).toHaveBeenCalledWith("markean:workspace");
  });

  it("skips migration when localStorage is unavailable", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage unavailable");
      },
    });

    await migrateFromLocalStorage();

    expect(await db.notes.toArray()).toEqual([]);
    expect(await db.folders.toArray()).toEqual([]);
  });
});

describe("bootstrapApp", () => {
  afterEach(async () => {
    resetSchedulerForTests();
    try {
      await getDb().delete();
    } catch {
      // Some failed bootstrap paths may not initialize a database.
    }
    resetDbForTests();
    resetStores();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates a welcome note, loads local stores, and starts scheduler when remote bootstrap fails", async () => {
    installStorageMock();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("offline")),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    const notes = await db.notes.toArray();
    const folders = await db.folders.toArray();
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe("welcome-note");
    expect(folders).toHaveLength(1);
    expect(folders[0].id).toBe("notes");
    expect(useNotesStore.getState().notes).toEqual(notes);
    expect(useFoldersStore.getState().folders).toEqual(folders);
    expect(useEditorStore.getState()).toMatchObject({
      activeFolderId: "notes",
      activeNoteId: "welcome-note",
    });
    expect(getScheduler()).not.toBeNull();

    const pendingChanges = await db.pendingChanges.toArray();
    expect(pendingChanges).toHaveLength(2);
    expect(pendingChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "folder",
          entityId: "notes",
          operation: "create",
          baseRevision: 0,
        }),
        expect.objectContaining({
          entityType: "note",
          entityId: "welcome-note",
          operation: "create",
          baseRevision: 0,
        }),
      ]),
    );
  });

  it("merges newer remote bootstrap records and stores the sync cursor", async () => {
    installStorageMock();
    const remoteFolder: FolderRecord = {
      id: "remote-folder",
      name: "Remote",
      sortOrder: 1,
      currentRevision: 3,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    const remoteNote: NoteRecord = {
      id: "remote-note",
      folderId: "remote-folder",
      title: "Remote note",
      bodyMd: "# Remote",
      bodyPlain: "Remote",
      currentRevision: 4,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [remoteFolder],
          notes: [remoteNote],
          syncCursor: 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.folders.get("remote-folder")).resolves.toEqual(remoteFolder);
    await expect(db.notes.get("remote-note")).resolves.toEqual(remoteNote);
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "42",
    });
    expect(useFoldersStore.getState().folders).toContainEqual(remoteFolder);
    expect(useNotesStore.getState().notes).toContainEqual(remoteNote);
  });

  it("does not overwrite local records with pending changes during remote bootstrap", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const localFolder: FolderRecord = {
      id: "shared-folder",
      name: "Local folder",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    const localNote: NoteRecord = {
      id: "shared-note",
      folderId: "shared-folder",
      title: "Local note",
      bodyMd: "# Local",
      bodyPlain: "Local",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.put(localFolder);
    await localDb.notes.put(localNote);
    await queueChange(localDb, {
      entityType: "folder",
      entityId: localFolder.id,
      operation: "update",
      baseRevision: localFolder.currentRevision,
    });
    await queueChange(localDb, {
      entityType: "note",
      entityId: localNote.id,
      operation: "update",
      baseRevision: localNote.currentRevision,
    });
    localDb.close();

    const remoteFolder: FolderRecord = {
      ...localFolder,
      name: "Remote folder",
      currentRevision: 9,
      updatedAt: "2026-04-22T10:00:00.000Z",
    };
    const remoteNote: NoteRecord = {
      ...localNote,
      title: "Remote note",
      bodyMd: "# Remote",
      bodyPlain: "Remote",
      currentRevision: 10,
      updatedAt: "2026-04-22T10:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [remoteFolder],
          notes: [remoteNote],
          syncCursor: 7,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.folders.get(localFolder.id)).resolves.toEqual(localFolder);
    await expect(db.notes.get(localNote.id)).resolves.toEqual(localNote);
    const pendingChanges = await db.pendingChanges.toArray();
    expect(pendingChanges).toHaveLength(2);
    expect(pendingChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "folder",
          entityId: localFolder.id,
          operation: "update",
          baseRevision: localFolder.currentRevision,
        }),
        expect.objectContaining({
          entityType: "note",
          entityId: localNote.id,
          operation: "update",
          baseRevision: localNote.currentRevision,
        }),
      ]),
    );
  });

  it("merges remote records when same ID pending changes are for a different entity type", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const pendingFolder: FolderRecord = {
      id: "shared",
      name: "Pending folder",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    const pendingNote: NoteRecord = {
      id: "shared-folder",
      folderId: "shared",
      title: "Pending note",
      bodyMd: "# Pending",
      bodyPlain: "Pending",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.put(pendingFolder);
    await localDb.notes.put(pendingNote);
    await queueChange(localDb, {
      entityType: "folder",
      entityId: pendingFolder.id,
      operation: "update",
      baseRevision: pendingFolder.currentRevision,
    });
    await queueChange(localDb, {
      entityType: "note",
      entityId: pendingNote.id,
      operation: "update",
      baseRevision: pendingNote.currentRevision,
    });
    localDb.close();

    const remoteNoteWithFolderPendingId: NoteRecord = {
      id: pendingFolder.id,
      folderId: "shared-folder",
      title: "Remote note with folder-pending ID",
      bodyMd: "# Remote note",
      bodyPlain: "Remote note",
      currentRevision: 5,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    const remoteFolderWithNotePendingId: FolderRecord = {
      id: pendingNote.id,
      name: "Remote folder with note-pending ID",
      sortOrder: 1,
      currentRevision: 6,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [remoteFolderWithNotePendingId],
          notes: [remoteNoteWithFolderPendingId],
          syncCursor: 11,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.notes.get(remoteNoteWithFolderPendingId.id)).resolves.toEqual(
      remoteNoteWithFolderPendingId,
    );
    await expect(db.folders.get(remoteFolderWithNotePendingId.id)).resolves.toEqual(
      remoteFolderWithNotePendingId,
    );
    await expect(db.folders.get(pendingFolder.id)).resolves.toEqual(pendingFolder);
    await expect(db.notes.get(pendingNote.id)).resolves.toEqual(pendingNote);
  });
});
