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
  setBootstrapConcurrencyHooksForTests,
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition was not met");
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
    resetSchedulerForTests();
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
    [
      "empty folder id",
      {
        folders: [{ id: "", name: "Notes" }],
        notes: [],
        activeFolderId: "",
        activeNoteId: "",
      },
    ],
    [
      "whitespace note id",
      {
        folders: [{ id: "notes", name: "Notes" }],
        notes: [
          {
            id: "   ",
            folderId: "notes",
            title: "Hello",
            body: "# Hello",
            updatedAt: "2026-04-21T09:00:00.000Z",
          },
        ],
        activeFolderId: "notes",
        activeNoteId: "",
      },
    ],
    [
      "empty note folder id",
      {
        folders: [{ id: "notes", name: "Notes" }],
        notes: [
          {
            id: "note_1",
            folderId: "",
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
      "duplicate folder ids",
      {
        folders: [
          { id: "notes", name: "Notes" },
          { id: "notes", name: "Duplicate" },
        ],
        notes: [],
        activeFolderId: "notes",
        activeNoteId: "",
      },
    ],
    [
      "duplicate note ids",
      {
        folders: [{ id: "notes", name: "Notes" }],
        notes: [
          {
            id: "note_1",
            folderId: "notes",
            title: "Hello",
            body: "# Hello",
            updatedAt: "2026-04-21T09:00:00.000Z",
          },
          {
            id: "note_1",
            folderId: "notes",
            title: "Duplicate",
            body: "# Duplicate",
            updatedAt: "2026-04-21T09:00:00.000Z",
          },
        ],
        activeFolderId: "notes",
        activeNoteId: "note_1",
      },
    ],
    [
      "active note without active folder",
      {
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

  it("does not duplicate pending create changes during overlapping migrations", async () => {
    const { store } = installStorageMock();
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
        activeFolderId: "notes",
        activeNoteId: "note_1",
      }),
    );
    let overlappingRun: Promise<void> | null = null;
    setBootstrapConcurrencyHooksForTests({
      beforeMigrationWrite: () => {
        if (!overlappingRun) {
          overlappingRun = migrateFromLocalStorage();
        }
      },
    });

    await migrateFromLocalStorage();
    await overlappingRun;

    const pendingChanges = await db.pendingChanges.toArray();
    expect(pendingChanges).toHaveLength(2);
    expect(pendingChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "folder",
          entityId: "notes",
          operation: "create",
        }),
        expect.objectContaining({
          entityType: "note",
          entityId: "note_1",
          operation: "create",
        }),
      ]),
    );
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

  it("preserves migrated legacy active selection during bootstrap", async () => {
    const { store } = installStorageMock();
    store.set(
      "markean:workspace",
      JSON.stringify({
        folders: [
          { id: "first", name: "First" },
          { id: "second", name: "Second" },
        ],
        notes: [
          {
            id: "first_note",
            folderId: "first",
            title: "First note",
            body: "# First",
            updatedAt: "2026-04-21T09:00:00.000Z",
          },
          {
            id: "second_note",
            folderId: "second",
            title: "Second note",
            body: "# Second",
            updatedAt: "2026-04-21T10:00:00.000Z",
          },
        ],
        activeFolderId: "second",
        activeNoteId: "second_note",
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("offline")),
    );

    await bootstrapApp("https://example.test");

    expect(useEditorStore.getState()).toMatchObject({
      activeFolderId: "second",
      activeNoteId: "second_note",
    });
  });

  it("preserves migrated active selection when the migrating bootstrap becomes stale before restore", async () => {
    const { store } = installStorageMock();
    store.set(
      "markean:workspace",
      JSON.stringify({
        folders: [
          { id: "first", name: "First" },
          { id: "second", name: "Second" },
        ],
        notes: [
          {
            id: "first_note",
            folderId: "first",
            title: "First note",
            body: "# First",
            updatedAt: "2026-04-21T09:00:00.000Z",
          },
          {
            id: "second_note",
            folderId: "second",
            title: "Second note",
            body: "# Second",
            updatedAt: "2026-04-21T10:00:00.000Z",
          },
        ],
        activeFolderId: "second",
        activeNoteId: "second_note",
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("offline")),
    );
    let latestRun: Promise<void> | null = null;
    setBootstrapConcurrencyHooksForTests({
      afterMigration: () => {
        if (!latestRun) {
          latestRun = bootstrapApp("https://example.test");
        }
      },
    });

    await bootstrapApp("https://example.test");
    await latestRun;

    expect(useEditorStore.getState()).toMatchObject({
      activeFolderId: "second",
      activeNoteId: "second_note",
    });
  });

  it("keeps migrated selection available until a current bootstrap completes", async () => {
    const { store } = installStorageMock();
    store.set(
      "markean:workspace",
      JSON.stringify({
        folders: [
          { id: "first", name: "First" },
          { id: "second", name: "Second" },
        ],
        notes: [
          {
            id: "first_note",
            folderId: "first",
            title: "First note",
            body: "# First",
            updatedAt: "2026-04-21T09:00:00.000Z",
          },
          {
            id: "second_note",
            folderId: "second",
            title: "Second note",
            body: "# Second",
            updatedAt: "2026-04-21T10:00:00.000Z",
          },
        ],
        activeFolderId: "second",
        activeNoteId: "second_note",
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          json: vi.fn().mockResolvedValue({
            folders: [],
            notes: [],
            syncCursor: 1,
          }),
        })
        .mockRejectedValue(new Error("offline")),
    );
    let secondRun: Promise<void> | null = null;
    let thirdRun: Promise<void> | null = null;
    setBootstrapConcurrencyHooksForTests({
      afterMigration: () => {
        if (!secondRun) {
          secondRun = bootstrapApp("https://example.test");
        }
      },
      beforeRemoteWrite: () => {
        if (!thirdRun) {
          thirdRun = bootstrapApp("https://example.test");
        }
      },
    });

    await bootstrapApp("https://example.test");
    await secondRun;
    await thirdRun;

    expect(useEditorStore.getState()).toMatchObject({
      activeFolderId: "second",
      activeNoteId: "second_note",
    });
  });

  it("preserves empty migrated legacy active selection during bootstrap", async () => {
    const { store } = installStorageMock();
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("offline")),
    );

    await bootstrapApp("https://example.test");

    expect(useEditorStore.getState()).toMatchObject({
      activeFolderId: "",
      activeNoteId: "",
    });
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

  it("does not duplicate welcome pending create changes during overlapping bootstraps", async () => {
    installStorageMock();
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    let overlappingRun: Promise<void> | null = null;
    setBootstrapConcurrencyHooksForTests({
      beforeWelcomeWrite: () => {
        if (!overlappingRun) {
          overlappingRun = bootstrapApp("https://example.test");
        }
      },
    });

    await bootstrapApp("https://example.test");
    await overlappingRun;

    const db = getDb();
    const pendingChanges = await db.pendingChanges.toArray();
    expect(pendingChanges).toHaveLength(2);
    expect(pendingChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "folder",
          entityId: "notes",
          operation: "create",
        }),
        expect.objectContaining({
          entityType: "note",
          entityId: "welcome-note",
          operation: "create",
        }),
      ]),
    );
  });

  it("preserves local data and sync cursor when remote bootstrap payload is invalid", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const localFolder: FolderRecord = {
      id: "local-folder",
      name: "Local",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    const localNote: NoteRecord = {
      id: "local-note",
      folderId: localFolder.id,
      title: "Local note",
      bodyMd: "# Local",
      bodyPlain: "Local",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.put(localFolder);
    await localDb.notes.put(localNote);
    await localDb.syncState.put({ key: "syncCursor", value: "37" });
    localDb.close();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          error: "unauthorized",
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.folders.toArray()).resolves.toEqual([localFolder]);
    await expect(db.notes.toArray()).resolves.toEqual([localNote]);
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "37",
    });
    expect(getScheduler()).not.toBeNull();
  });

  it("preserves local data and sync cursor when remote note entry is malformed", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const localFolder: FolderRecord = {
      id: "local-folder",
      name: "Local",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.put(localFolder);
    await localDb.syncState.put({ key: "syncCursor", value: "37" });
    localDb.close();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [],
          notes: [{ id: "bad", currentRevision: 1 }],
          syncCursor: 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.folders.toArray()).resolves.toEqual([localFolder]);
    await expect(db.notes.get("bad")).resolves.toBeUndefined();
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "37",
    });
  });

  it("preserves local data and sync cursor when remote folder entry is malformed", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const localFolder: FolderRecord = {
      id: "local-folder",
      name: "Local",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.put(localFolder);
    await localDb.syncState.put({ key: "syncCursor", value: "37" });
    localDb.close();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [{ id: "bad-folder", name: "Bad", currentRevision: 1 }],
          notes: [],
          syncCursor: 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.folders.toArray()).resolves.toEqual([localFolder]);
    await expect(db.folders.get("bad-folder")).resolves.toBeUndefined();
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "37",
    });
  });

  it("preserves local data and sync cursor when remote note references a missing folder", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    await localDb.syncState.put({ key: "syncCursor", value: "37" });
    localDb.close();
    const orphanNote: NoteRecord = {
      id: "orphan-note",
      folderId: "missing-folder",
      title: "Orphan",
      bodyMd: "# Orphan",
      bodyPlain: "Orphan",
      currentRevision: 1,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [],
          notes: [orphanNote],
          syncCursor: 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.notes.get(orphanNote.id)).resolves.toBeUndefined();
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "37",
    });
  });

  it("rejects a remote note that references a locally deleted folder", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const deletedFolder: FolderRecord = {
      id: "deleted-folder",
      name: "Deleted",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: "2026-04-22T09:00:00.000Z",
    };
    await localDb.folders.put(deletedFolder);
    await localDb.syncState.put({ key: "syncCursor", value: "37" });
    localDb.close();
    const remoteNote: NoteRecord = {
      id: "remote-note",
      folderId: deletedFolder.id,
      title: "Remote note",
      bodyMd: "# Remote",
      bodyPlain: "Remote",
      currentRevision: 2,
      updatedAt: "2026-04-23T10:00:00.000Z",
      deletedAt: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [],
          notes: [remoteNote],
          syncCursor: 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.folders.get(deletedFolder.id)).resolves.toEqual(deletedFolder);
    await expect(db.notes.get(remoteNote.id)).resolves.toBeUndefined();
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "37",
    });
    expect(getScheduler()).not.toBeNull();
  });

  it("rejects deleted remote folders and notes that reference them", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const localFolder: FolderRecord = {
      id: "local-folder",
      name: "Local",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.put(localFolder);
    await localDb.syncState.put({ key: "syncCursor", value: "37" });
    localDb.close();
    const remoteFolder: FolderRecord = {
      id: "remote-deleted-folder",
      name: "Remote deleted",
      sortOrder: 1,
      currentRevision: 2,
      updatedAt: "2026-04-23T10:00:00.000Z",
      deletedAt: "2026-04-23T11:00:00.000Z",
    };
    const remoteNote: NoteRecord = {
      id: "remote-note",
      folderId: remoteFolder.id,
      title: "Remote note",
      bodyMd: "# Remote",
      bodyPlain: "Remote",
      currentRevision: 2,
      updatedAt: "2026-04-23T10:00:00.000Z",
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
    await expect(db.folders.get(localFolder.id)).resolves.toEqual(localFolder);
    await expect(db.folders.get(remoteFolder.id)).resolves.toBeUndefined();
    await expect(db.notes.get(remoteNote.id)).resolves.toBeUndefined();
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "37",
    });
  });

  it("rejects deleted remote notes from the active bootstrap snapshot", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const localFolder: FolderRecord = {
      id: "local-folder",
      name: "Local",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.put(localFolder);
    await localDb.syncState.put({ key: "syncCursor", value: "37" });
    localDb.close();
    const remoteNote: NoteRecord = {
      id: "remote-deleted-note",
      folderId: localFolder.id,
      title: "Remote note",
      bodyMd: "# Remote",
      bodyPlain: "Remote",
      currentRevision: 2,
      updatedAt: "2026-04-23T10:00:00.000Z",
      deletedAt: "2026-04-23T11:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [],
          notes: [remoteNote],
          syncCursor: 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.folders.get(localFolder.id)).resolves.toEqual(localFolder);
    await expect(db.notes.get(remoteNote.id)).resolves.toBeUndefined();
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "37",
    });
  });

  const invalidNumericBootstrapCases: Array<[
    string,
    {
      syncCursor?: number;
      folder?: Partial<FolderRecord>;
      note?: Partial<NoteRecord>;
    },
  ]> = [
    ["negative sync cursor", { syncCursor: -1 }],
    ["fractional sync cursor", { syncCursor: 1.5 }],
    [
      "negative folder revision",
      { folder: { currentRevision: -1 } },
    ],
    [
      "fractional folder revision",
      { folder: { currentRevision: 1.5 } },
    ],
    [
      "negative note revision",
      { note: { currentRevision: -1 } },
    ],
    [
      "fractional note revision",
      { note: { currentRevision: 1.5 } },
    ],
  ];

  it.each(invalidNumericBootstrapCases)("rejects remote bootstrap with %s", async (_name, override) => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const localFolder: FolderRecord = {
      id: "local-folder",
      name: "Local",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.put(localFolder);
    await localDb.syncState.put({ key: "syncCursor", value: "37" });
    localDb.close();

    const remoteFolder: FolderRecord = {
      id: "remote-folder",
      name: "Remote",
      sortOrder: 1,
      currentRevision: 2,
      updatedAt: "2026-04-23T10:00:00.000Z",
      deletedAt: null,
      ...override.folder,
    };
    const remoteNote: NoteRecord = {
      id: "remote-note",
      folderId: remoteFolder.id,
      title: "Remote note",
      bodyMd: "# Remote",
      bodyPlain: "Remote",
      currentRevision: 2,
      updatedAt: "2026-04-23T10:00:00.000Z",
      deletedAt: null,
      ...override.note,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [remoteFolder],
          notes: [remoteNote],
          syncCursor: override.syncCursor ?? 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.folders.get(localFolder.id)).resolves.toEqual(localFolder);
    await expect(db.folders.get(remoteFolder.id)).resolves.toBeUndefined();
    await expect(db.notes.get(remoteNote.id)).resolves.toBeUndefined();
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "37",
    });
    expect(getScheduler()).not.toBeNull();
  });

  it("rejects duplicate remote folder IDs", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    await localDb.syncState.put({ key: "syncCursor", value: "37" });
    localDb.close();
    const firstFolder: FolderRecord = {
      id: "duplicate-folder",
      name: "First",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-23T10:00:00.000Z",
      deletedAt: null,
    };
    const secondFolder: FolderRecord = {
      ...firstFolder,
      name: "Second",
      sortOrder: 1,
      currentRevision: 2,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [firstFolder, secondFolder],
          notes: [],
          syncCursor: 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.folders.get(firstFolder.id)).resolves.toBeUndefined();
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "37",
    });
  });

  it("rejects duplicate remote note IDs", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const localFolder: FolderRecord = {
      id: "local-folder",
      name: "Local",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.put(localFolder);
    await localDb.syncState.put({ key: "syncCursor", value: "37" });
    localDb.close();
    const firstNote: NoteRecord = {
      id: "duplicate-note",
      folderId: localFolder.id,
      title: "First",
      bodyMd: "# First",
      bodyPlain: "First",
      currentRevision: 1,
      updatedAt: "2026-04-23T10:00:00.000Z",
      deletedAt: null,
    };
    const secondNote: NoteRecord = {
      ...firstNote,
      title: "Second",
      bodyMd: "# Second",
      bodyPlain: "Second",
      currentRevision: 2,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [],
          notes: [firstNote, secondNote],
          syncCursor: 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.notes.get(firstNote.id)).resolves.toBeUndefined();
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "37",
    });
  });

  it("clears stale active note when fallback folder has no active notes", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const localFolder: FolderRecord = {
      id: "empty-folder",
      name: "Empty",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.put(localFolder);
    localDb.close();
    useEditorStore.setState({
      activeFolderId: "old-folder",
      activeNoteId: "stale-note",
      searchQuery: "",
      mobileView: "folders",
      newNoteId: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("offline")),
    );

    await bootstrapApp("https://example.test");

    expect(useEditorStore.getState()).toMatchObject({
      activeFolderId: "empty-folder",
      activeNoteId: "",
    });
  });

  it("clears stale active folder and note when fallback has no active folders", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    await localDb.folders.put({
      id: "deleted-folder",
      name: "Deleted",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: "2026-04-22T09:00:00.000Z",
    });
    localDb.close();
    useEditorStore.setState({
      activeFolderId: "old-folder",
      activeNoteId: "stale-note",
      searchQuery: "",
      mobileView: "folders",
      newNoteId: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("offline")),
    );

    await bootstrapApp("https://example.test");

    expect(useEditorStore.getState()).toMatchObject({
      activeFolderId: "",
      activeNoteId: "",
    });
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

  it("accepts a valid remote note that references an existing local folder", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const localFolder: FolderRecord = {
      id: "local-folder",
      name: "Local",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.put(localFolder);
    localDb.close();
    const remoteNote: NoteRecord = {
      id: "remote-note",
      folderId: localFolder.id,
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
          folders: [],
          notes: [remoteNote],
          syncCursor: 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.folders.get(localFolder.id)).resolves.toEqual(localFolder);
    await expect(db.notes.get(remoteNote.id)).resolves.toEqual(remoteNote);
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "42",
    });
  });

  it("soft-deletes non-pending local records absent from valid remote active snapshot", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const localFolder: FolderRecord = {
      id: "local-folder",
      name: "Local",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    const localNote: NoteRecord = {
      id: "local-note",
      folderId: localFolder.id,
      title: "Local note",
      bodyMd: "# Local",
      bodyPlain: "Local",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.put(localFolder);
    await localDb.notes.put(localNote);
    localDb.close();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [],
          notes: [],
          syncCursor: 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    const prunedFolder = await db.folders.get(localFolder.id);
    const prunedNote = await db.notes.get(localNote.id);
    expect(prunedFolder).toMatchObject({
      ...localFolder,
      deletedAt: expect.any(String),
    });
    expect(prunedNote).toMatchObject({
      ...localNote,
      deletedAt: expect.any(String),
    });
    await expect(db.pendingChanges.toArray()).resolves.toHaveLength(0);
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "42",
    });
  });

  it("revalidates editor selection when remote snapshot deletes the selected note", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const localFolder: FolderRecord = {
      id: "notes",
      name: "Notes",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    const selectedNote: NoteRecord = {
      id: "a-selected-note",
      folderId: localFolder.id,
      title: "Selected note",
      bodyMd: "# Selected",
      bodyPlain: "Selected",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    const remainingNote: NoteRecord = {
      id: "b-remaining-note",
      folderId: localFolder.id,
      title: "Remaining note",
      bodyMd: "# Remaining",
      bodyPlain: "Remaining",
      currentRevision: 2,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.put(localFolder);
    await localDb.notes.bulkPut([selectedNote, remainingNote]);
    localDb.close();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [localFolder],
          notes: [remainingNote],
          syncCursor: 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.notes.get(selectedNote.id)).resolves.toMatchObject({
      deletedAt: expect.any(String),
    });
    expect(useEditorStore.getState()).toMatchObject({
      activeFolderId: localFolder.id,
      activeNoteId: remainingNote.id,
    });
  });

  it("revalidates editor selection when remote snapshot deletes the selected folder", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const selectedFolder: FolderRecord = {
      id: "a-selected-folder",
      name: "Selected",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    const remainingFolder: FolderRecord = {
      id: "b-remaining-folder",
      name: "Remaining",
      sortOrder: 1,
      currentRevision: 2,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    const selectedNote: NoteRecord = {
      id: "a-selected-note",
      folderId: selectedFolder.id,
      title: "Selected note",
      bodyMd: "# Selected",
      bodyPlain: "Selected",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    const remainingNote: NoteRecord = {
      id: "b-remaining-note",
      folderId: remainingFolder.id,
      title: "Remaining note",
      bodyMd: "# Remaining",
      bodyPlain: "Remaining",
      currentRevision: 2,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.bulkPut([selectedFolder, remainingFolder]);
    await localDb.notes.bulkPut([selectedNote, remainingNote]);
    localDb.close();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [remainingFolder],
          notes: [remainingNote],
          syncCursor: 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.folders.get(selectedFolder.id)).resolves.toMatchObject({
      deletedAt: expect.any(String),
    });
    expect(useEditorStore.getState()).toMatchObject({
      activeFolderId: remainingFolder.id,
      activeNoteId: remainingNote.id,
    });
  });

  it("preserves valid editor selection after remote merge", async () => {
    const { store } = installStorageMock();
    store.set(
      "markean:workspace",
      JSON.stringify({
        folders: [
          { id: "first", name: "First" },
          { id: "second", name: "Second" },
        ],
        notes: [
          {
            id: "first_note",
            folderId: "first",
            title: "First note",
            body: "# First",
            updatedAt: "2026-04-21T09:00:00.000Z",
          },
          {
            id: "second_note",
            folderId: "second",
            title: "Second note",
            body: "# Second",
            updatedAt: "2026-04-21T10:00:00.000Z",
          },
        ],
        activeFolderId: "second",
        activeNoteId: "second_note",
      }),
    );
    const remoteFirstFolder: FolderRecord = {
      id: "first",
      name: "First",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    const remoteSecondFolder: FolderRecord = {
      id: "second",
      name: "Second",
      sortOrder: 1,
      currentRevision: 1,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    const remoteFirstNote: NoteRecord = {
      id: "first_note",
      folderId: "first",
      title: "First note",
      bodyMd: "# First",
      bodyPlain: "First",
      currentRevision: 1,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    const remoteSecondNote: NoteRecord = {
      id: "second_note",
      folderId: "second",
      title: "Second note",
      bodyMd: "# Second",
      bodyPlain: "Second",
      currentRevision: 1,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [remoteFirstFolder, remoteSecondFolder],
          notes: [remoteFirstNote, remoteSecondNote],
          syncCursor: 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    expect(useEditorStore.getState()).toMatchObject({
      activeFolderId: "second",
      activeNoteId: "second_note",
    });
  });

  it("preserves pending local records absent from valid remote active snapshot", async () => {
    installStorageMock();
    const localDb = createWebDatabase("markean");
    const localFolder: FolderRecord = {
      id: "pending-folder",
      name: "Pending folder",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    const localNote: NoteRecord = {
      id: "pending-note",
      folderId: localFolder.id,
      title: "Pending note",
      bodyMd: "# Pending",
      bodyPlain: "Pending",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await localDb.folders.put(localFolder);
    await localDb.notes.put(localNote);
    await localDb.syncState.put({ key: "syncCursor", value: "3" });
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [],
          notes: [],
          syncCursor: 42,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.folders.get(localFolder.id)).resolves.toEqual(localFolder);
    await expect(db.notes.get(localNote.id)).resolves.toEqual(localNote);
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "42",
    });
    const pendingChanges = await db.pendingChanges.toArray();
    expect(pendingChanges).toHaveLength(2);
    expect(pendingChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "folder",
          entityId: localFolder.id,
        }),
        expect.objectContaining({
          entityType: "note",
          entityId: localNote.id,
        }),
      ]),
    );
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "42",
    });
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
    await localDb.syncState.put({ key: "syncCursor", value: "3" });
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
    const otherRemoteFolder: FolderRecord = {
      id: "other-remote-folder",
      name: "Other remote folder",
      sortOrder: 1,
      currentRevision: 2,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    const otherRemoteNote: NoteRecord = {
      id: "other-remote-note",
      folderId: otherRemoteFolder.id,
      title: "Other remote note",
      bodyMd: "# Other",
      bodyPlain: "Other",
      currentRevision: 2,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          folders: [remoteFolder, otherRemoteFolder],
          notes: [remoteNote, otherRemoteNote],
          syncCursor: 7,
        }),
      }),
    );

    await bootstrapApp("https://example.test");

    const db = getDb();
    await expect(db.folders.get(localFolder.id)).resolves.toEqual(localFolder);
    await expect(db.notes.get(localNote.id)).resolves.toEqual(localNote);
    await expect(db.folders.get(otherRemoteFolder.id)).resolves.toEqual(otherRemoteFolder);
    await expect(db.notes.get(otherRemoteNote.id)).resolves.toEqual(otherRemoteNote);
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "3",
    });
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

  it("ignores stale overlapping bootstrap results and starts only the latest scheduler lifecycle", async () => {
    installStorageMock();
    const firstBootstrap = createDeferred<{
      folders: FolderRecord[];
      notes: NoteRecord[];
      syncCursor: number;
    }>();
    const latestFolder: FolderRecord = {
      id: "race-folder",
      name: "Latest folder",
      sortOrder: 1,
      currentRevision: 2,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    const staleFolder: FolderRecord = {
      ...latestFolder,
      name: "Stale folder",
      currentRevision: 9,
      updatedAt: "2026-04-23T10:00:00.000Z",
    };
    const latestNote: NoteRecord = {
      id: "race-note",
      folderId: latestFolder.id,
      title: "Latest note",
      bodyMd: "# Latest",
      bodyPlain: "Latest",
      currentRevision: 2,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };
    const staleNote: NoteRecord = {
      ...latestNote,
      title: "Stale note",
      bodyMd: "# Stale",
      bodyPlain: "Stale",
      currentRevision: 9,
      updatedAt: "2026-04-23T10:00:00.000Z",
    };
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockReturnValue(firstBootstrap.promise),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          folders: [latestFolder],
          notes: [latestNote],
          syncCursor: 2,
        }),
      });
    vi.stubGlobal("fetch", fetch);

    const staleRun = bootstrapApp("https://example.test");
    await waitForCondition(() => fetch.mock.calls.length === 1);

    await bootstrapApp("https://example.test");
    firstBootstrap.resolve({
      folders: [staleFolder],
      notes: [staleNote],
      syncCursor: 9,
    });
    await staleRun;

    const db = getDb();
    await expect(db.folders.get(latestFolder.id)).resolves.toEqual(latestFolder);
    await expect(db.notes.get(latestNote.id)).resolves.toEqual(latestNote);
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "2",
    });
    expect(addListener.mock.calls.filter(([event]) => event === "online")).toHaveLength(1);
    expect(addListener.mock.calls.filter(([event]) => event === "offline")).toHaveLength(1);
    expect(removeListener.mock.calls.filter(([event]) => event === "online")).toHaveLength(0);
    expect(removeListener.mock.calls.filter(([event]) => event === "offline")).toHaveLength(0);
  });

  it("aborts stale remote merge when a newer bootstrap starts during the transaction", async () => {
    installStorageMock();
    const staleFolder: FolderRecord = {
      id: "transaction-folder",
      name: "Stale folder",
      sortOrder: 1,
      currentRevision: 9,
      updatedAt: "2026-04-23T10:00:00.000Z",
      deletedAt: null,
    };
    const latestFolder: FolderRecord = {
      ...staleFolder,
      name: "Latest folder",
      currentRevision: 2,
      updatedAt: "2026-04-22T10:00:00.000Z",
    };
    const staleNote: NoteRecord = {
      id: "transaction-note",
      folderId: staleFolder.id,
      title: "Stale note",
      bodyMd: "# Stale",
      bodyPlain: "Stale",
      currentRevision: 9,
      updatedAt: "2026-04-23T10:00:00.000Z",
      deletedAt: null,
    };
    const latestNote: NoteRecord = {
      ...staleNote,
      title: "Latest note",
      bodyMd: "# Latest",
      bodyPlain: "Latest",
      currentRevision: 2,
      updatedAt: "2026-04-22T10:00:00.000Z",
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          folders: [staleFolder],
          notes: [staleNote],
          syncCursor: 9,
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          folders: [latestFolder],
          notes: [latestNote],
          syncCursor: 2,
        }),
      });
    vi.stubGlobal("fetch", fetch);
    let latestRun: Promise<void> | null = null;
    setBootstrapConcurrencyHooksForTests({
      beforeRemoteWrite: () => {
        if (!latestRun) {
          latestRun = bootstrapApp("https://example.test");
        }
      },
    });

    await bootstrapApp("https://example.test");
    await latestRun;

    const db = getDb();
    await expect(db.folders.get(latestFolder.id)).resolves.toEqual(latestFolder);
    await expect(db.notes.get(latestNote.id)).resolves.toEqual(latestNote);
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "2",
    });
  });
});
