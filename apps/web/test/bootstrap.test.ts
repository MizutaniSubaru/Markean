import "fake-indexeddb/auto";

import type { FolderRecord, NoteRecord } from "@markean/domain";
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
import { bootstrapApp, getScheduler, migrateFromLocalStorage } from "../src/app/bootstrap";

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
    key: vi.fn(() => null),
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

    expect(storage.removeItem).toHaveBeenCalledWith("markean:workspace");
    expect(storage.removeItem).toHaveBeenCalledWith("markean:draft:note_1");
    expect(storage.removeItem).toHaveBeenCalledWith("markean:sync-status");
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
    const scheduler = getScheduler();
    scheduler?.stop();
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
});
