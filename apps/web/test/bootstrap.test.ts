import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebDatabase } from "@markean/storage-web";
import type { MarkeanWebDatabase } from "@markean/storage-web";
import { initDb } from "../src/features/notes/persistence/db";
import { useNotesStore } from "../src/features/notes/store/notes.store";
import { useFoldersStore } from "../src/features/notes/store/folders.store";
import { useEditorStore } from "../src/features/notes/store/editor.store";
import { migrateFromLocalStorage } from "../src/app/bootstrap";

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

describe("migrateFromLocalStorage", () => {
  let db: MarkeanWebDatabase;

  beforeEach(() => {
    db = createWebDatabase(`test-bootstrap-${crypto.randomUUID()}`);
    initDb(db);
    useNotesStore.setState({ notes: [] });
    useFoldersStore.setState({ folders: [] });
    useEditorStore.setState({
      activeFolderId: "",
      activeNoteId: "",
      searchQuery: "",
      mobileView: "folders",
      newNoteId: null,
    });
  });

  afterEach(async () => {
    await db.delete();
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

  it("ignores invalid localStorage payloads", async () => {
    const { store } = installStorageMock();
    store.set("markean:workspace", "{not-valid-json");

    await migrateFromLocalStorage();

    await expect(db.notes.toArray()).resolves.toHaveLength(0);
    await expect(db.folders.toArray()).resolves.toHaveLength(0);
  });
});
