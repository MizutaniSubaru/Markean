# Frontend-Backend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the frontend web app to the backend API by replacing localStorage with IndexedDB (Dexie), introducing Zustand stores, and wiring sync-core's push/pull cycle end-to-end.

**Architecture:** Store-Centric five-layer architecture. UI reads from Zustand stores. Write operations optimistically update stores, then persist to IndexedDB via a persistence layer, which triggers sync-core's push/pull cycle through an event-driven scheduler. Pull results hydrate back into stores.

**Tech Stack:** Zustand 5, Dexie (via @markean/storage-web), @markean/sync-core, @markean/api-client, Vitest, fake-indexeddb

---

## File Map

### New files (apps/web/src/)

| File | Responsibility |
|------|---------------|
| `features/notes/store/notes.store.ts` | Note list state + CRUD actions with optimistic updates |
| `features/notes/store/folders.store.ts` | Folder list state + CRUD actions |
| `features/notes/store/editor.store.ts` | UI-only state: active selection, search, mobile view |
| `features/notes/store/sync.store.ts` | Sync status, online/offline tracking |
| `features/notes/persistence/db.ts` | DB instance holder, init function |
| `features/notes/persistence/notes.persistence.ts` | IndexedDB note read/write + PendingChange recording |
| `features/notes/persistence/folders.persistence.ts` | IndexedDB folder read/write + PendingChange recording |
| `features/notes/persistence/db.ts` | DB instance holder, init function |
| `features/notes/sync/sync.service.ts` | Orchestrates runSyncCycle, hydrates stores after pull |
| `features/notes/sync/sync.scheduler.ts` | Debounce push, poll pull, online recovery, mutex |
| `features/notes/sync/conflict.handler.ts` | Creates conflict copies from push conflicts |
| `features/notes/hooks/useNoteList.ts` | Derives filtered, sorted, grouped note sections |
| `features/notes/hooks/useEditorActions.ts` | Wraps changeBody with optimistic + persistence + sync trigger |
| `features/notes/index.ts` | Public exports for the feature |
| `app/App.tsx` | Replaces current App.tsx, components read from stores directly |
| `app/bootstrap.ts` | App init: DB creation, migration, hydrate, start sync |

### New test files

| File | Tests |
|------|-------|
| `apps/web/test/stores/notes.store.test.ts` | Note store CRUD |
| `apps/web/test/stores/folders.store.test.ts` | Folder store CRUD |
| `apps/web/test/stores/editor.store.test.ts` | Editor UI state |
| `apps/web/test/stores/sync.store.test.ts` | Sync status transitions |
| `apps/web/test/persistence/notes.persistence.test.ts` | IndexedDB note persistence + PendingChange |
| `apps/web/test/persistence/folders.persistence.test.ts` | IndexedDB folder persistence + PendingChange |
| `apps/web/test/sync/sync.service.test.ts` | Sync cycle orchestration |
| `apps/web/test/sync/sync.scheduler.test.ts` | Scheduler debounce + polling |
| `apps/web/test/sync/conflict.handler.test.ts` | Conflict copy creation |
| `apps/web/test/bootstrap.test.ts` | Bootstrap + migration |
| `apps/web/test/hooks/use-note-list.test.ts` | Note list derivation |

### Modified files

| File | Change |
|------|--------|
| `packages/sync-core/src/push-pull.ts` | pushChanges/runSyncCycle return conflicts |
| `packages/sync-core/test/sync-engine.test.ts` | Update test for new return type |
| `apps/web/package.json` | Add zustand, storage-web, sync-core deps |
| `apps/web/src/main.tsx` | Call bootstrapApp before render |
| `apps/web/src/components/desktop/Editor.tsx` | Remove storage.ts import, use domain NoteRecord |
| `apps/web/src/components/mobile/MobileEditor.tsx` | Remove storage.ts import, use domain NoteRecord |
| `apps/web/test/app.test.tsx` | Rewrite to test store-based App |

### Deleted files

| File | Reason |
|------|--------|
| `apps/web/src/useAppModel.ts` | Replaced by stores + hooks |
| `apps/web/src/lib/storage.ts` | Replaced by IndexedDB persistence |
| `apps/web/src/lib/sync.ts` | Replaced by sync.scheduler.ts |
| `apps/web/src/lib/bootstrap.ts` | Replaced by app/bootstrap.ts |
| `apps/web/src/state/app-store.ts` | Replaced by Zustand stores |

---

## Task 1: Expand sync-core pushChanges/runSyncCycle return type

**Files:**
- Modify: `packages/sync-core/src/push-pull.ts`
- Test: `packages/sync-core/test/sync-engine.test.ts`

- [ ] **Step 1: Write a test for pushChanges returning conflicts**

Add this test to `packages/sync-core/test/sync-engine.test.ts`:

```ts
it("returns conflicts from the server response", async () => {
  const db = createWebDatabase(`test-markean-push-conflicts-${crypto.randomUUID()}`);

  await db.notes.put({
    id: "note_conflict",
    folderId: "folder_1",
    title: "Stale",
    bodyMd: "Stale body",
    bodyPlain: "Stale body",
    currentRevision: 1,
    updatedAt: "2026-04-21T09:00:00.000Z",
    deletedAt: null,
  });

  await queueChange(db, {
    entityType: "note",
    entityId: "note_conflict",
    operation: "update",
    baseRevision: 1,
  });

  const apiClient = {
    async syncPush() {
      return {
        accepted: [],
        conflicts: [{ entityType: "note", entityId: "note_conflict", serverRevision: 5 }],
      };
    },
    async syncPull() {
      throw new Error("syncPull should not be called");
    },
  };

  const result = await pushChanges(db, apiClient, "device_1");

  expect(result.conflicts).toEqual([
    { entityType: "note", entityId: "note_conflict", serverRevision: 5 },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/sync-core`

Expected: FAIL — `pushChanges` currently returns `void`, not an object with `conflicts`.

- [ ] **Step 3: Modify pushChanges to return conflicts**

In `packages/sync-core/src/push-pull.ts`, change the `pushChanges` function:

Replace the return type and add a return statement:

```ts
export async function pushChanges(
  db: SyncableDatabase,
  apiClient: ApiClient,
  deviceId: string,
): Promise<{ conflicts: Array<{ entityType: string; entityId: string; serverRevision: number }> }> {
  const pending = await db.pendingChanges.toArray();
  if (pending.length === 0) return { conflicts: [] };

  const changes = [];
  for (const p of pending) {
    let payload: Record<string, unknown> | null = null;

    if (p.operation !== "delete") {
      if (p.entityType === "note") {
        const note = await db.notes.get(p.entityId);
        if (note) {
          payload = { folderId: note.folderId, title: note.title, bodyMd: note.bodyMd };
        }
      } else {
        const folder = await db.folders.get(p.entityId);
        if (folder) {
          payload = { name: folder.name, sortOrder: folder.sortOrder };
        }
      }
    }

    changes.push({
      clientChangeId: p.clientChangeId,
      entityType: p.entityType,
      entityId: p.entityId,
      operation: p.operation,
      baseRevision: p.baseRevision,
      payload,
    });
  }

  const result = await apiClient.syncPush({ deviceId, changes });
  const acceptedChanges = pending.slice(0, result.accepted.length);

  for (const [index, accepted] of result.accepted.entries()) {
    const change = acceptedChanges[index];
    if (!change) continue;

    if (change.entityType === "note") {
      await db.notes.update(change.entityId, { currentRevision: accepted.acceptedRevision });
    } else {
      await db.folders.update(change.entityId, { currentRevision: accepted.acceptedRevision });
    }
  }

  if (result.accepted.length > 0) {
    const acceptedIds = acceptedChanges.map((p) => p.clientChangeId);
    await db.pendingChanges.where("clientChangeId").anyOf(acceptedIds).delete();
  }

  const latestCursor = result.accepted.at(-1)?.cursor;
  if (latestCursor !== undefined) {
    await db.syncState.put({ key: "syncCursor", value: String(latestCursor) });
  }

  return { conflicts: result.conflicts ?? [] };
}
```

Also update `runSyncCycle`:

```ts
export async function runSyncCycle(
  db: SyncableDatabase,
  apiClient: ApiClient,
): Promise<{ conflicts: Array<{ entityType: string; entityId: string; serverRevision: number }> }> {
  const deviceId = await getDeviceId(db);
  const { conflicts } = await pushChanges(db, apiClient, deviceId);
  await pullChanges(db, apiClient, deviceId);
  return { conflicts };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/sync-core`

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sync-core/src/push-pull.ts packages/sync-core/test/sync-engine.test.ts
git commit -m "feat(sync-core): return conflicts from pushChanges and runSyncCycle"
```

---

## Task 2: Add new dependencies to web app

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add workspace dependencies and zustand**

```bash
cd /Users/mizutanisubaru/mycode/Markean && pnpm --filter @markean/web add zustand @markean/storage-web@workspace:* @markean/sync-core@workspace:*
```

- [ ] **Step 2: Add fake-indexeddb as dev dependency for tests**

```bash
cd /Users/mizutanisubaru/mycode/Markean && pnpm --filter @markean/web add -D fake-indexeddb
```

- [ ] **Step 3: Verify installation**

```bash
cd /Users/mizutanisubaru/mycode/Markean && pnpm --filter @markean/web exec tsc --noEmit --pretty 2>&1 | head -5
```

Expected: No new type errors (existing may be fine).

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add zustand, storage-web, sync-core dependencies"
```

---

## Task 3: Create sync.store.ts

**Files:**
- Create: `apps/web/src/features/notes/store/sync.store.ts`
- Create: `apps/web/test/stores/sync.store.test.ts`

- [ ] **Step 1: Write tests**

```ts
// apps/web/test/stores/sync.store.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { useSyncStore } from "../../src/features/notes/store/sync.store";

describe("sync.store", () => {
  afterEach(() => {
    useSyncStore.setState({
      status: "idle",
      isOnline: true,
      lastSyncedAt: null,
    });
  });

  it("starts with idle status", () => {
    expect(useSyncStore.getState().status).toBe("idle");
  });

  it("transitions to unsynced", () => {
    useSyncStore.getState().markUnsynced();
    expect(useSyncStore.getState().status).toBe("unsynced");
  });

  it("transitions to syncing", () => {
    useSyncStore.getState().markSyncing();
    expect(useSyncStore.getState().status).toBe("syncing");
  });

  it("transitions to synced and records timestamp", () => {
    useSyncStore.getState().markSynced();
    const state = useSyncStore.getState();
    expect(state.status).toBe("idle");
    expect(state.lastSyncedAt).not.toBeNull();
  });

  it("transitions to error", () => {
    useSyncStore.getState().markError("network failure");
    expect(useSyncStore.getState().status).toBe("error");
  });

  it("tracks online/offline", () => {
    useSyncStore.getState().setOnline(false);
    expect(useSyncStore.getState().isOnline).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/stores/sync.store.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement sync.store.ts**

```ts
// apps/web/src/features/notes/store/sync.store.ts
import { create } from "zustand";

type SyncStatus = "idle" | "syncing" | "unsynced" | "error";

type SyncState = {
  status: SyncStatus;
  isOnline: boolean;
  lastSyncedAt: string | null;
  markUnsynced: () => void;
  markSyncing: () => void;
  markSynced: () => void;
  markError: (message?: string) => void;
  setOnline: (online: boolean) => void;
};

export const useSyncStore = create<SyncState>((set) => ({
  status: "idle",
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  lastSyncedAt: null,

  markUnsynced: () => set({ status: "unsynced" }),
  markSyncing: () => set({ status: "syncing" }),
  markSynced: () => set({ status: "idle", lastSyncedAt: new Date().toISOString() }),
  markError: () => set({ status: "error" }),
  setOnline: (online) => set({ isOnline: online }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/stores/sync.store.test.ts`

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/notes/store/sync.store.ts apps/web/test/stores/sync.store.test.ts
git commit -m "feat(web): add sync status zustand store"
```

---

## Task 4: Create editor.store.ts

**Files:**
- Create: `apps/web/src/features/notes/store/editor.store.ts`
- Create: `apps/web/test/stores/editor.store.test.ts`

- [ ] **Step 1: Write tests**

```ts
// apps/web/test/stores/editor.store.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../../src/features/notes/store/editor.store";

describe("editor.store", () => {
  afterEach(() => {
    useEditorStore.setState({
      activeFolderId: "",
      activeNoteId: "",
      searchQuery: "",
      mobileView: "folders",
      newNoteId: null,
    });
  });

  it("selects a folder", () => {
    useEditorStore.getState().selectFolder("folder_1");
    expect(useEditorStore.getState().activeFolderId).toBe("folder_1");
  });

  it("selects a note", () => {
    useEditorStore.getState().selectNote("note_1");
    expect(useEditorStore.getState().activeNoteId).toBe("note_1");
  });

  it("sets search query", () => {
    useEditorStore.getState().setSearchQuery("hello");
    expect(useEditorStore.getState().searchQuery).toBe("hello");
  });

  it("sets mobile view", () => {
    useEditorStore.getState().setMobileView("editor");
    expect(useEditorStore.getState().mobileView).toBe("editor");
  });

  it("sets new note id", () => {
    useEditorStore.getState().setNewNoteId("note_new");
    expect(useEditorStore.getState().newNoteId).toBe("note_new");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/stores/editor.store.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement editor.store.ts**

```ts
// apps/web/src/features/notes/store/editor.store.ts
import { create } from "zustand";

type MobileView = "folders" | "notes" | "editor";

type EditorState = {
  activeFolderId: string;
  activeNoteId: string;
  searchQuery: string;
  mobileView: MobileView;
  newNoteId: string | null;
  selectFolder: (id: string) => void;
  selectNote: (id: string) => void;
  setSearchQuery: (query: string) => void;
  setMobileView: (view: MobileView) => void;
  setNewNoteId: (id: string | null) => void;
};

export const useEditorStore = create<EditorState>((set) => ({
  activeFolderId: "",
  activeNoteId: "",
  searchQuery: "",
  mobileView: "folders",
  newNoteId: null,

  selectFolder: (id) => set({ activeFolderId: id, searchQuery: "" }),
  selectNote: (id) => set({ activeNoteId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setMobileView: (view) => set({ mobileView: view }),
  setNewNoteId: (id) => set({ newNoteId: id }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/stores/editor.store.test.ts`

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/notes/store/editor.store.ts apps/web/test/stores/editor.store.test.ts
git commit -m "feat(web): add editor UI state zustand store"
```

---

## Task 5: Create folders.store.ts

**Files:**
- Create: `apps/web/src/features/notes/store/folders.store.ts`
- Create: `apps/web/test/stores/folders.store.test.ts`

- [ ] **Step 1: Write tests**

```ts
// apps/web/test/stores/folders.store.test.ts
import { afterEach, describe, expect, it } from "vitest";
import type { FolderRecord } from "@markean/domain";
import { useFoldersStore } from "../../src/features/notes/store/folders.store";

const folder1: FolderRecord = {
  id: "folder_1",
  name: "Notes",
  sortOrder: 0,
  currentRevision: 1,
  updatedAt: "2026-04-21T09:00:00.000Z",
  deletedAt: null,
};

describe("folders.store", () => {
  afterEach(() => {
    useFoldersStore.setState({ folders: [] });
  });

  it("starts with empty folders", () => {
    expect(useFoldersStore.getState().folders).toEqual([]);
  });

  it("loads folders from hydration", () => {
    useFoldersStore.getState().loadFolders([folder1]);
    expect(useFoldersStore.getState().folders).toEqual([folder1]);
  });

  it("adds a folder optimistically", () => {
    useFoldersStore.getState().addFolder("Work");
    const folders = useFoldersStore.getState().folders;
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe("Work");
    expect(folders[0].id).toMatch(/^folder_/);
    expect(folders[0].currentRevision).toBe(0);
    expect(folders[0].deletedAt).toBeNull();
  });

  it("soft-deletes a folder optimistically", () => {
    useFoldersStore.getState().loadFolders([folder1]);
    useFoldersStore.getState().deleteFolder("folder_1");
    const folders = useFoldersStore.getState().folders;
    expect(folders[0].deletedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/stores/folders.store.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement folders.store.ts**

```ts
// apps/web/src/features/notes/store/folders.store.ts
import { create } from "zustand";
import type { FolderRecord } from "@markean/domain";

type FoldersState = {
  folders: FolderRecord[];
  loadFolders: (folders: FolderRecord[]) => void;
  addFolder: (name: string) => FolderRecord;
  deleteFolder: (id: string) => void;
};

function createId() {
  return `folder_${crypto.randomUUID()}`;
}

export const useFoldersStore = create<FoldersState>((set, get) => ({
  folders: [],

  loadFolders: (folders) => set({ folders }),

  addFolder: (name) => {
    const folder: FolderRecord = {
      id: createId(),
      name,
      sortOrder: get().folders.length,
      currentRevision: 0,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
    set((state) => ({ folders: [...state.folders, folder] }));
    return folder;
  },

  deleteFolder: (id) =>
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === id ? { ...f, deletedAt: new Date().toISOString() } : f,
      ),
    })),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/stores/folders.store.test.ts`

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/notes/store/folders.store.ts apps/web/test/stores/folders.store.test.ts
git commit -m "feat(web): add folders zustand store"
```

---

## Task 6: Create notes.store.ts

**Files:**
- Create: `apps/web/src/features/notes/store/notes.store.ts`
- Create: `apps/web/test/stores/notes.store.test.ts`

- [ ] **Step 1: Write tests**

```ts
// apps/web/test/stores/notes.store.test.ts
import { afterEach, describe, expect, it } from "vitest";
import type { NoteRecord } from "@markean/domain";
import { useNotesStore } from "../../src/features/notes/store/notes.store";

const note1: NoteRecord = {
  id: "note_1",
  folderId: "folder_1",
  title: "Test",
  bodyMd: "# Test",
  bodyPlain: "Test",
  currentRevision: 1,
  updatedAt: "2026-04-21T09:00:00.000Z",
  deletedAt: null,
};

describe("notes.store", () => {
  afterEach(() => {
    useNotesStore.setState({ notes: [] });
  });

  it("starts with empty notes", () => {
    expect(useNotesStore.getState().notes).toEqual([]);
  });

  it("loads notes from hydration", () => {
    useNotesStore.getState().loadNotes([note1]);
    expect(useNotesStore.getState().notes).toEqual([note1]);
  });

  it("adds a note optimistically", () => {
    useNotesStore.getState().addNote("folder_1");
    const notes = useNotesStore.getState().notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].folderId).toBe("folder_1");
    expect(notes[0].id).toMatch(/^note_/);
    expect(notes[0].bodyMd).toBe("");
    expect(notes[0].currentRevision).toBe(0);
  });

  it("updates a note optimistically", () => {
    useNotesStore.getState().loadNotes([note1]);
    useNotesStore.getState().updateNote("note_1", { bodyMd: "# Updated", title: "Updated" });
    const note = useNotesStore.getState().notes[0];
    expect(note.bodyMd).toBe("# Updated");
    expect(note.title).toBe("Updated");
    expect(note.updatedAt).not.toBe(note1.updatedAt);
  });

  it("soft-deletes a note optimistically", () => {
    useNotesStore.getState().loadNotes([note1]);
    useNotesStore.getState().deleteNote("note_1");
    expect(useNotesStore.getState().notes[0].deletedAt).not.toBeNull();
  });

  it("adds a conflict copy", () => {
    useNotesStore.getState().loadNotes([note1]);
    const copy: NoteRecord = {
      ...note1,
      id: "note_conflict_copy",
      title: "Test (conflict copy)",
    };
    useNotesStore.getState().addConflictCopy(copy);
    expect(useNotesStore.getState().notes).toHaveLength(2);
    expect(useNotesStore.getState().notes[0].id).toBe("note_conflict_copy");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/stores/notes.store.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement notes.store.ts**

```ts
// apps/web/src/features/notes/store/notes.store.ts
import { create } from "zustand";
import { markdownToPlainText } from "@markean/domain";
import type { NoteRecord } from "@markean/domain";

type NotesState = {
  notes: NoteRecord[];
  loadNotes: (notes: NoteRecord[]) => void;
  addNote: (folderId: string) => NoteRecord;
  updateNote: (id: string, changes: Partial<Pick<NoteRecord, "bodyMd" | "title" | "folderId">>) => void;
  deleteNote: (id: string) => void;
  addConflictCopy: (note: NoteRecord) => void;
};

function createId() {
  return `note_${crypto.randomUUID()}`;
}

export const useNotesStore = create<NotesState>((set) => ({
  notes: [],

  loadNotes: (notes) => set({ notes }),

  addNote: (folderId) => {
    const note: NoteRecord = {
      id: createId(),
      folderId,
      title: "",
      bodyMd: "",
      bodyPlain: "",
      currentRevision: 0,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
    set((state) => ({ notes: [note, ...state.notes] }));
    return note;
  },

  updateNote: (id, changes) =>
    set((state) => ({
      notes: state.notes.map((n) => {
        if (n.id !== id) return n;
        const updated = { ...n, ...changes, updatedAt: new Date().toISOString() };
        if (changes.bodyMd !== undefined) {
          updated.bodyPlain = markdownToPlainText(changes.bodyMd);
        }
        return updated;
      }),
    })),

  deleteNote: (id) =>
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id ? { ...n, deletedAt: new Date().toISOString() } : n,
      ),
    })),

  addConflictCopy: (note) =>
    set((state) => ({ notes: [note, ...state.notes] })),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/stores/notes.store.test.ts`

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/notes/store/notes.store.ts apps/web/test/stores/notes.store.test.ts
git commit -m "feat(web): add notes zustand store"
```

---

## Task 7: Create persistence layer

**Files:**
- Create: `apps/web/src/features/notes/persistence/db.ts`
- Create: `apps/web/src/features/notes/persistence/notes.persistence.ts`
- Create: `apps/web/src/features/notes/persistence/folders.persistence.ts`
- Create: `apps/web/test/persistence/notes.persistence.test.ts`
- Create: `apps/web/test/persistence/folders.persistence.test.ts`

- [ ] **Step 1: Create db.ts (DB instance holder)**

```ts
// apps/web/src/features/notes/persistence/db.ts
import type { MarkeanWebDatabase } from "@markean/storage-web";

let _db: MarkeanWebDatabase | null = null;

export function initDb(db: MarkeanWebDatabase): void {
  _db = db;
}

export function getDb(): MarkeanWebDatabase {
  if (!_db) throw new Error("Database not initialized. Call initDb() first.");
  return _db;
}
```

- [ ] **Step 2: Write notes persistence tests**

```ts
// apps/web/test/persistence/notes.persistence.test.ts
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebDatabase } from "@markean/storage-web";
import type { MarkeanWebDatabase } from "@markean/storage-web";
import type { NoteRecord } from "@markean/domain";
import { initDb } from "../../src/features/notes/persistence/db";
import {
  createNote,
  deleteNote,
  getAllNotes,
  getNoteById,
  updateNote,
} from "../../src/features/notes/persistence/notes.persistence";

describe("notes.persistence", () => {
  let db: MarkeanWebDatabase;

  const note: NoteRecord = {
    id: "note_1",
    folderId: "folder_1",
    title: "Test",
    bodyMd: "# Test",
    bodyPlain: "Test",
    currentRevision: 0,
    updatedAt: "2026-04-21T09:00:00.000Z",
    deletedAt: null,
  };

  beforeEach(() => {
    db = createWebDatabase(`test-persistence-${crypto.randomUUID()}`);
    initDb(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  it("creates a note and queues a pending change", async () => {
    await createNote(note);

    const stored = await db.notes.get("note_1");
    expect(stored).toMatchObject({ id: "note_1", title: "Test" });

    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entityType: "note",
      entityId: "note_1",
      operation: "create",
      baseRevision: 0,
    });
  });

  it("reads all notes", async () => {
    await createNote(note);
    const all = await getAllNotes();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("note_1");
  });

  it("reads a note by id", async () => {
    await createNote(note);
    const found = await getNoteById("note_1");
    expect(found?.id).toBe("note_1");
  });

  it("updates a note and queues a pending change", async () => {
    await createNote(note);
    await updateNote("note_1", { bodyMd: "# Updated" });

    const stored = await db.notes.get("note_1");
    expect(stored?.bodyMd).toBe("# Updated");

    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(2);
    expect(changes[1]).toMatchObject({
      entityType: "note",
      operation: "update",
    });
  });

  it("soft-deletes a note and queues a pending change", async () => {
    await createNote(note);
    await deleteNote("note_1");

    const stored = await db.notes.get("note_1");
    expect(stored?.deletedAt).not.toBeNull();

    const changes = await db.pendingChanges.toArray();
    const deleteChange = changes.find((c) => c.operation === "delete");
    expect(deleteChange).toMatchObject({
      entityType: "note",
      entityId: "note_1",
      operation: "delete",
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/persistence/notes.persistence.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement notes.persistence.ts**

```ts
// apps/web/src/features/notes/persistence/notes.persistence.ts
import type { NoteRecord } from "@markean/domain";
import { queueChange } from "@markean/sync-core";
import { getDb } from "./db";

export async function getAllNotes(): Promise<NoteRecord[]> {
  return getDb().notes.toArray();
}

export async function getNoteById(id: string): Promise<NoteRecord | undefined> {
  return getDb().notes.get(id);
}

export async function createNote(note: NoteRecord): Promise<void> {
  const db = getDb();
  await db.notes.put(note);
  await queueChange(db, {
    entityType: "note",
    entityId: note.id,
    operation: "create",
    baseRevision: 0,
  });
}

export async function updateNote(
  id: string,
  changes: Partial<NoteRecord>,
): Promise<void> {
  const db = getDb();
  const existing = await db.notes.get(id);
  if (!existing) return;

  await db.notes.update(id, { ...changes, updatedAt: new Date().toISOString() });
  await queueChange(db, {
    entityType: "note",
    entityId: id,
    operation: "update",
    baseRevision: existing.currentRevision,
  });
}

export async function deleteNote(id: string): Promise<void> {
  const db = getDb();
  const existing = await db.notes.get(id);
  if (!existing) return;

  await db.notes.update(id, { deletedAt: new Date().toISOString() });
  await queueChange(db, {
    entityType: "note",
    entityId: id,
    operation: "delete",
    baseRevision: existing.currentRevision,
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/persistence/notes.persistence.test.ts`

Expected: All 5 tests PASS.

- [ ] **Step 6: Write folders persistence tests**

```ts
// apps/web/test/persistence/folders.persistence.test.ts
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebDatabase } from "@markean/storage-web";
import type { MarkeanWebDatabase } from "@markean/storage-web";
import type { FolderRecord } from "@markean/domain";
import { initDb } from "../../src/features/notes/persistence/db";
import {
  createFolder,
  deleteFolder,
  getAllFolders,
} from "../../src/features/notes/persistence/folders.persistence";

describe("folders.persistence", () => {
  let db: MarkeanWebDatabase;

  const folder: FolderRecord = {
    id: "folder_1",
    name: "Notes",
    sortOrder: 0,
    currentRevision: 0,
    updatedAt: "2026-04-21T09:00:00.000Z",
    deletedAt: null,
  };

  beforeEach(() => {
    db = createWebDatabase(`test-folders-persistence-${crypto.randomUUID()}`);
    initDb(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  it("creates a folder and queues a pending change", async () => {
    await createFolder(folder);

    const stored = await db.folders.get("folder_1");
    expect(stored).toMatchObject({ id: "folder_1", name: "Notes" });

    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entityType: "folder",
      entityId: "folder_1",
      operation: "create",
    });
  });

  it("reads all folders", async () => {
    await createFolder(folder);
    const all = await getAllFolders();
    expect(all).toHaveLength(1);
  });

  it("soft-deletes a folder and queues a pending change", async () => {
    await createFolder(folder);
    await deleteFolder("folder_1");

    const stored = await db.folders.get("folder_1");
    expect(stored?.deletedAt).not.toBeNull();

    const changes = await db.pendingChanges.toArray();
    const deleteChange = changes.find((c) => c.operation === "delete");
    expect(deleteChange).toMatchObject({
      entityType: "folder",
      entityId: "folder_1",
      operation: "delete",
    });
  });
});
```

- [ ] **Step 7: Implement folders.persistence.ts**

```ts
// apps/web/src/features/notes/persistence/folders.persistence.ts
import type { FolderRecord } from "@markean/domain";
import { queueChange } from "@markean/sync-core";
import { getDb } from "./db";

export async function getAllFolders(): Promise<FolderRecord[]> {
  return getDb().folders.toArray();
}

export async function createFolder(folder: FolderRecord): Promise<void> {
  const db = getDb();
  await db.folders.put(folder);
  await queueChange(db, {
    entityType: "folder",
    entityId: folder.id,
    operation: "create",
    baseRevision: 0,
  });
}

export async function deleteFolder(id: string): Promise<void> {
  const db = getDb();
  const existing = await db.folders.get(id);
  if (!existing) return;

  await db.folders.update(id, { deletedAt: new Date().toISOString() });
  await queueChange(db, {
    entityType: "folder",
    entityId: id,
    operation: "delete",
    baseRevision: existing.currentRevision,
  });
}
```

- [ ] **Step 8: Run all persistence tests**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/persistence/`

Expected: All 8 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/notes/persistence/ apps/web/test/persistence/
git commit -m "feat(web): add IndexedDB persistence layer for notes and folders"
```

---

## Task 8: Create conflict handler

**Files:**
- Create: `apps/web/src/features/notes/sync/conflict.handler.ts`
- Create: `apps/web/test/sync/conflict.handler.test.ts`

- [ ] **Step 1: Write tests**

```ts
// apps/web/test/sync/conflict.handler.test.ts
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

    const copy = storeNotes.find((n) => n.id !== "note_1");
    expect(copy).toBeDefined();
    expect(copy!.title).toContain("(conflict copy)");
    expect(copy!.bodyMd).toBe("# Local");

    const dbCopy = await db.notes.get(copy!.id);
    expect(dbCopy).toBeDefined();
  });

  it("skips conflicts for non-note entity types", async () => {
    await handleConflicts([
      { entityType: "folder", entityId: "folder_1", serverRevision: 3 },
    ]);
    expect(useNotesStore.getState().notes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/sync/conflict.handler.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement conflict.handler.ts**

```ts
// apps/web/src/features/notes/sync/conflict.handler.ts
import type { NoteRecord } from "@markean/domain";
import { getDb } from "../persistence/db";
import { createNote } from "../persistence/notes.persistence";
import { useNotesStore } from "../store/notes.store";

type Conflict = {
  entityType: string;
  entityId: string;
  serverRevision: number;
};

export async function handleConflicts(conflicts: Conflict[]): Promise<void> {
  const db = getDb();

  for (const conflict of conflicts) {
    if (conflict.entityType !== "note") continue;

    const localNote = await db.notes.get(conflict.entityId);
    if (!localNote) continue;

    const copy: NoteRecord = {
      ...localNote,
      id: `note_${crypto.randomUUID()}`,
      title: `${localNote.title} (conflict copy)`,
      currentRevision: 0,
      updatedAt: new Date().toISOString(),
    };

    await createNote(copy);
    useNotesStore.getState().addConflictCopy(copy);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/sync/conflict.handler.test.ts`

Expected: All 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/notes/sync/conflict.handler.ts apps/web/test/sync/conflict.handler.test.ts
git commit -m "feat(web): add conflict copy handler for sync conflicts"
```

---

## Task 9: Create sync service

**Files:**
- Create: `apps/web/src/features/notes/sync/sync.service.ts`
- Create: `apps/web/test/sync/sync.service.test.ts`

- [ ] **Step 1: Write tests**

```ts
// apps/web/test/sync/sync.service.test.ts
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebDatabase } from "@markean/storage-web";
import type { MarkeanWebDatabase } from "@markean/storage-web";
import { initDb } from "../../src/features/notes/persistence/db";
import { useSyncStore } from "../../src/features/notes/store/sync.store";
import { useNotesStore } from "../../src/features/notes/store/notes.store";
import { useFoldersStore } from "../../src/features/notes/store/folders.store";
import { createSyncService } from "../../src/features/notes/sync/sync.service";

function createMockApiClient(options?: { conflicts?: Array<{ entityType: string; entityId: string; serverRevision: number }> }) {
  return {
    bootstrap: vi.fn(),
    syncPush: vi.fn().mockResolvedValue({
      accepted: [],
      conflicts: options?.conflicts ?? [],
    }),
    syncPull: vi.fn().mockResolvedValue({
      nextCursor: 1,
      events: [],
    }),
    restoreNote: vi.fn(),
    listTrash: vi.fn(),
  };
}

describe("sync.service", () => {
  let db: MarkeanWebDatabase;

  beforeEach(() => {
    db = createWebDatabase(`test-sync-service-${crypto.randomUUID()}`);
    initDb(db);
    useSyncStore.setState({ status: "idle", isOnline: true, lastSyncedAt: null });
    useNotesStore.setState({ notes: [] });
    useFoldersStore.setState({ folders: [] });
  });

  afterEach(async () => {
    await db.delete();
  });

  it("runs a sync cycle and transitions status idle → syncing → idle", async () => {
    const apiClient = createMockApiClient();
    const service = createSyncService(apiClient);

    const statusHistory: string[] = [];
    useSyncStore.subscribe((state) => statusHistory.push(state.status));

    await service.executeSyncCycle();

    expect(statusHistory).toContain("syncing");
    expect(useSyncStore.getState().status).toBe("idle");
    expect(useSyncStore.getState().lastSyncedAt).not.toBeNull();
  });

  it("sets error status on failure", async () => {
    const apiClient = createMockApiClient();
    apiClient.syncPush.mockRejectedValue(new Error("network"));
    const service = createSyncService(apiClient);

    await service.executeSyncCycle();

    expect(useSyncStore.getState().status).toBe("error");
  });

  it("hydrates notes store after pull", async () => {
    const apiClient = createMockApiClient();
    const service = createSyncService(apiClient);

    await db.notes.put({
      id: "note_from_db",
      folderId: "f1",
      title: "DB note",
      bodyMd: "body",
      bodyPlain: "body",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    });

    await service.executeSyncCycle();

    expect(useNotesStore.getState().notes).toHaveLength(1);
    expect(useNotesStore.getState().notes[0].id).toBe("note_from_db");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/sync/sync.service.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement sync.service.ts**

```ts
// apps/web/src/features/notes/sync/sync.service.ts
import { runSyncCycle } from "@markean/sync-core";
import { getDb } from "../persistence/db";
import { getAllNotes } from "../persistence/notes.persistence";
import { getAllFolders } from "../persistence/folders.persistence";
import { useNotesStore } from "../store/notes.store";
import { useFoldersStore } from "../store/folders.store";
import { useSyncStore } from "../store/sync.store";
import { handleConflicts } from "./conflict.handler";

type ApiClient = Parameters<typeof runSyncCycle>[1];

export function createSyncService(apiClient: ApiClient) {
  async function executeSyncCycle(): Promise<void> {
    useSyncStore.getState().markSyncing();

    try {
      const { conflicts } = await runSyncCycle(getDb(), apiClient);

      if (conflicts.length > 0) {
        await handleConflicts(conflicts);
      }

      const [notes, folders] = await Promise.all([getAllNotes(), getAllFolders()]);
      useNotesStore.getState().loadNotes(notes);
      useFoldersStore.getState().loadFolders(folders);
      useSyncStore.getState().markSynced();
    } catch {
      useSyncStore.getState().markError();
    }
  }

  return { executeSyncCycle };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/sync/sync.service.test.ts`

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/notes/sync/sync.service.ts apps/web/test/sync/sync.service.test.ts
git commit -m "feat(web): add sync service orchestrating push/pull cycle"
```

---

## Task 10: Create sync scheduler

**Files:**
- Create: `apps/web/src/features/notes/sync/sync.scheduler.ts`
- Create: `apps/web/test/sync/sync.scheduler.test.ts`

- [ ] **Step 1: Write tests**

```ts
// apps/web/test/sync/sync.scheduler.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncStore } from "../../src/features/notes/store/sync.store";
import { createSyncScheduler } from "../../src/features/notes/sync/sync.scheduler";

describe("sync.scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSyncStore.setState({ status: "idle", isOnline: true, lastSyncedAt: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs sync cycle on requestSync after debounce", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createSyncScheduler(executeSyncCycle);

    scheduler.requestSync();
    expect(executeSyncCycle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(executeSyncCycle).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("resets debounce timer on repeated requestSync calls", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createSyncScheduler(executeSyncCycle);

    scheduler.requestSync();
    await vi.advanceTimersByTimeAsync(300);
    scheduler.requestSync();
    await vi.advanceTimersByTimeAsync(300);

    expect(executeSyncCycle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(executeSyncCycle).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("runs periodic poll", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createSyncScheduler(executeSyncCycle);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(executeSyncCycle).toHaveBeenCalled();
    scheduler.stop();
  });

  it("does not run poll when already syncing", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createSyncScheduler(executeSyncCycle);

    useSyncStore.setState({ status: "syncing" });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(executeSyncCycle).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("stop cancels all timers", async () => {
    const executeSyncCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = createSyncScheduler(executeSyncCycle);

    scheduler.start();
    scheduler.requestSync();
    scheduler.stop();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(executeSyncCycle).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/sync/sync.scheduler.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement sync.scheduler.ts**

```ts
// apps/web/src/features/notes/sync/sync.scheduler.ts
import { useSyncStore } from "../store/sync.store";

const DEBOUNCE_MS = 500;
const POLL_INTERVAL_MS = 30_000;

export function createSyncScheduler(executeSyncCycle: () => Promise<void>) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let isSyncing = false;
  let pendingRetry = false;

  async function run(): Promise<void> {
    if (isSyncing) {
      pendingRetry = true;
      return;
    }

    isSyncing = true;
    try {
      await executeSyncCycle();
    } finally {
      isSyncing = false;
      if (pendingRetry) {
        pendingRetry = false;
        void run();
      }
    }
  }

  function requestSync(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void run();
    }, DEBOUNCE_MS);
  }

  function start(): void {
    pollTimer = setInterval(() => {
      const { status } = useSyncStore.getState();
      if (status === "syncing") return;
      void run();
    }, POLL_INTERVAL_MS);

    const handleOnline = () => {
      useSyncStore.getState().setOnline(true);
      void run();
    };
    const handleOffline = () => {
      useSyncStore.getState().setOnline(false);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    }
  }

  function stop(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  return { requestSync, start, stop };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/sync/sync.scheduler.test.ts`

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/notes/sync/sync.scheduler.ts apps/web/test/sync/sync.scheduler.test.ts
git commit -m "feat(web): add sync scheduler with debounce push and polling pull"
```

---

## Task 11: Create bootstrap with localStorage migration

**Files:**
- Create: `apps/web/src/app/bootstrap.ts`
- Create: `apps/web/test/bootstrap.test.ts`

- [ ] **Step 1: Write tests**

```ts
// apps/web/test/bootstrap.test.ts
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebDatabase } from "@markean/storage-web";
import type { MarkeanWebDatabase } from "@markean/storage-web";
import { initDb, getDb } from "../../src/features/notes/persistence/db";
import { useNotesStore } from "../../src/features/notes/store/notes.store";
import { useFoldersStore } from "../../src/features/notes/store/folders.store";
import { useEditorStore } from "../../src/features/notes/store/editor.store";
import { migrateFromLocalStorage } from "../../src/app/bootstrap";

function installStorageMock() {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
    clear: vi.fn(() => { store.clear(); }),
    get length() { return store.size; },
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
    useEditorStore.setState({ activeFolderId: "", activeNoteId: "", searchQuery: "", mobileView: "folders", newNoteId: null });
  });

  afterEach(async () => {
    await db.delete();
  });

  it("migrates workspace snapshot from localStorage to IndexedDB", async () => {
    const { storage, store } = installStorageMock();
    store.set("markean:workspace", JSON.stringify({
      folders: [{ id: "notes", name: "Notes" }],
      notes: [{
        id: "note_1",
        folderId: "notes",
        title: "Hello",
        body: "# Hello\n\nWorld",
        updatedAt: "2026-04-21T09:00:00.000Z",
      }],
      activeFolderId: "notes",
      activeNoteId: "note_1",
    }));
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
    store.set("markean:workspace", JSON.stringify({
      folders: [{ id: "notes", name: "Notes" }],
      notes: [],
      activeFolderId: "notes",
      activeNoteId: "",
    }));

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/bootstrap.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement bootstrap.ts**

```ts
// apps/web/src/app/bootstrap.ts
import { createWebDatabase } from "@markean/storage-web";
import { createApiClient } from "@markean/api-client";
import { markdownToPlainText } from "@markean/domain";
import type { NoteRecord, FolderRecord } from "@markean/domain";
import { initDb, getDb } from "../features/notes/persistence/db";
import { getAllNotes } from "../features/notes/persistence/notes.persistence";
import { getAllFolders } from "../features/notes/persistence/folders.persistence";
import { useNotesStore } from "../features/notes/store/notes.store";
import { useFoldersStore } from "../features/notes/store/folders.store";
import { useEditorStore } from "../features/notes/store/editor.store";
import { useSyncStore } from "../features/notes/store/sync.store";
import { createSyncService } from "../features/notes/sync/sync.service";
import { createSyncScheduler } from "../features/notes/sync/sync.scheduler";
import { getWelcomeNote } from "../features/notes/components/shared/WelcomeNote";

const WORKSPACE_KEY = "markean:workspace";
const DRAFT_PREFIX = "markean:draft:";

type LegacyWorkspace = {
  folders: Array<{ id: string; name: string }>;
  notes: Array<{
    id: string;
    folderId: string;
    title: string;
    body: string;
    updatedAt: string;
  }>;
  activeFolderId: string;
  activeNoteId: string;
};

export async function migrateFromLocalStorage(): Promise<void> {
  const db = getDb();

  const existingCount = await db.notes.count() + await db.folders.count();
  if (existingCount > 0) return;

  const raw = localStorage.getItem(WORKSPACE_KEY);
  if (!raw) return;

  let workspace: LegacyWorkspace;
  try {
    workspace = JSON.parse(raw);
  } catch {
    return;
  }

  if (!Array.isArray(workspace.folders) || !Array.isArray(workspace.notes)) return;

  const folders: FolderRecord[] = workspace.folders.map((f, i) => ({
    id: f.id,
    name: f.name,
    sortOrder: i,
    currentRevision: 0,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  }));

  const notes: NoteRecord[] = workspace.notes.map((n) => {
    const draft = localStorage.getItem(`${DRAFT_PREFIX}${n.id}`);
    const bodyMd = draft ?? n.body;
    return {
      id: n.id,
      folderId: n.folderId,
      title: n.title,
      bodyMd,
      bodyPlain: markdownToPlainText(bodyMd),
      currentRevision: 0,
      updatedAt: n.updatedAt || new Date().toISOString(),
      deletedAt: null,
    };
  });

  await db.transaction("rw", db.folders, db.notes, async () => {
    await db.folders.bulkPut(folders);
    await db.notes.bulkPut(notes);
  });

  localStorage.removeItem(WORKSPACE_KEY);
  for (const n of workspace.notes) {
    localStorage.removeItem(`${DRAFT_PREFIX}${n.id}`);
  }
  localStorage.removeItem("markean:sync-status");
}

function detectLocale(): string {
  if (typeof window === "undefined") return "en";
  try {
    const stored = localStorage.getItem("markean:locale");
    if (stored) return stored.startsWith("zh") ? "zh" : "en";
  } catch {
    // ignore
  }
  return navigator.language.startsWith("zh") ? "zh" : "en";
}

async function ensureWelcomeNote(): Promise<void> {
  const db = getDb();
  const noteCount = await db.notes.count();
  const folderCount = await db.folders.count();
  if (noteCount > 0 || folderCount > 0) return;

  const locale = detectLocale();
  const welcome = getWelcomeNote(locale);
  const folderId = "notes";
  const folderName = locale.startsWith("zh") ? "笔记" : "Notes";

  await db.folders.put({
    id: folderId,
    name: folderName,
    sortOrder: 0,
    currentRevision: 0,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  });

  await db.notes.put({
    id: "welcome-note",
    folderId,
    title: welcome.title,
    bodyMd: welcome.body,
    bodyPlain: markdownToPlainText(welcome.body),
    currentRevision: 0,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  });
}

let _scheduler: ReturnType<typeof createSyncScheduler> | null = null;

export function getScheduler() {
  return _scheduler;
}

export async function bootstrapApp(baseUrl = ""): Promise<void> {
  // Phase 1: Infrastructure
  const db = createWebDatabase("markean");
  const apiClient = createApiClient(baseUrl);
  initDb(db);

  // Phase 1.5: Migration
  await migrateFromLocalStorage();
  await ensureWelcomeNote();

  // Phase 2: Local data → stores (offline-ready)
  const [localNotes, localFolders] = await Promise.all([
    getAllNotes(),
    getAllFolders(),
  ]);
  useNotesStore.getState().loadNotes(localNotes);
  useFoldersStore.getState().loadFolders(localFolders);

  // Restore editor state
  const activeFolders = localFolders.filter((f) => !f.deletedAt);
  const activeNotes = localNotes.filter((n) => !n.deletedAt);
  if (activeFolders.length > 0) {
    useEditorStore.getState().selectFolder(activeFolders[0].id);
    const firstNote = activeNotes.find((n) => n.folderId === activeFolders[0].id);
    if (firstNote) {
      useEditorStore.getState().selectNote(firstNote.id);
    }
  }

  // Phase 3: Remote sync (non-blocking)
  const syncService = createSyncService(apiClient);
  _scheduler = createSyncScheduler(syncService.executeSyncCycle);

  try {
    const bootstrap = await apiClient.bootstrap();
    const serverNotes = (bootstrap.notes ?? []) as NoteRecord[];
    const serverFolders = (bootstrap.folders ?? []) as FolderRecord[];

    await db.transaction("rw", db.notes, db.folders, db.syncState, async () => {
      for (const note of serverNotes) {
        const local = await db.notes.get(note.id);
        if (!local || (note.currentRevision ?? 0) > (local.currentRevision ?? 0)) {
          await db.notes.put(note);
        }
      }
      for (const folder of serverFolders) {
        const local = await db.folders.get(folder.id);
        if (!local || (folder.currentRevision ?? 0) > (local.currentRevision ?? 0)) {
          await db.folders.put(folder);
        }
      }
      await db.syncState.put({
        key: "syncCursor",
        value: String(bootstrap.syncCursor ?? 0),
      });
    });

    const [freshNotes, freshFolders] = await Promise.all([
      getAllNotes(),
      getAllFolders(),
    ]);
    useNotesStore.getState().loadNotes(freshNotes);
    useFoldersStore.getState().loadFolders(freshFolders);
  } catch {
    // Offline or failed — continue with local data
  }

  _scheduler.start();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/bootstrap.test.ts`

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/bootstrap.ts apps/web/test/bootstrap.test.ts
git commit -m "feat(web): add bootstrap with localStorage migration and remote sync init"
```

---

## Task 12: Create feature hooks

**Files:**
- Create: `apps/web/src/features/notes/hooks/useNoteList.ts`
- Create: `apps/web/src/features/notes/hooks/useEditorActions.ts`
- Create: `apps/web/test/hooks/use-note-list.test.ts`

- [ ] **Step 1: Write useNoteList test**

```ts
// apps/web/test/hooks/use-note-list.test.ts
import { afterEach, describe, expect, it } from "vitest";
import type { NoteRecord } from "@markean/domain";
import { useNotesStore } from "../../src/features/notes/store/notes.store";
import { useEditorStore } from "../../src/features/notes/store/editor.store";
import { useFoldersStore } from "../../src/features/notes/store/folders.store";
import { deriveNoteList } from "../../src/features/notes/hooks/useNoteList";

const now = new Date("2026-04-21T09:00:00.000Z");

function makeNote(overrides: Partial<NoteRecord> & { id: string }): NoteRecord {
  return {
    folderId: "folder_1",
    title: overrides.id,
    bodyMd: "",
    bodyPlain: "",
    currentRevision: 1,
    updatedAt: now.toISOString(),
    deletedAt: null,
    ...overrides,
  };
}

describe("deriveNoteList", () => {
  afterEach(() => {
    useNotesStore.setState({ notes: [] });
    useEditorStore.setState({ activeFolderId: "", searchQuery: "" });
    useFoldersStore.setState({ folders: [] });
  });

  it("filters notes by active folder", () => {
    useNotesStore.setState({
      notes: [
        makeNote({ id: "n1", folderId: "f1" }),
        makeNote({ id: "n2", folderId: "f2" }),
      ],
    });
    useEditorStore.setState({ activeFolderId: "f1", searchQuery: "" });

    const { notesInScope } = deriveNoteList("en");
    expect(notesInScope).toHaveLength(1);
    expect(notesInScope[0].id).toBe("n1");
  });

  it("filters by search query across all folders", () => {
    useFoldersStore.setState({ folders: [{ id: "f1", name: "Work", sortOrder: 0, currentRevision: 1, updatedAt: now.toISOString(), deletedAt: null }] });
    useNotesStore.setState({
      notes: [
        makeNote({ id: "n1", folderId: "f1", title: "Meeting notes", bodyMd: "agenda" }),
        makeNote({ id: "n2", folderId: "f1", title: "Shopping list", bodyMd: "milk" }),
      ],
    });
    useEditorStore.setState({ activeFolderId: "f1", searchQuery: "meeting" });

    const { notesInScope } = deriveNoteList("en");
    expect(notesInScope).toHaveLength(1);
    expect(notesInScope[0].id).toBe("n1");
  });

  it("excludes soft-deleted notes", () => {
    useNotesStore.setState({
      notes: [
        makeNote({ id: "n1", folderId: "f1" }),
        makeNote({ id: "n2", folderId: "f1", deletedAt: now.toISOString() }),
      ],
    });
    useEditorStore.setState({ activeFolderId: "f1", searchQuery: "" });

    const { notesInScope } = deriveNoteList("en");
    expect(notesInScope).toHaveLength(1);
  });

  it("returns grouped sections", () => {
    useNotesStore.setState({
      notes: [makeNote({ id: "n1", folderId: "f1" })],
    });
    useEditorStore.setState({ activeFolderId: "f1", searchQuery: "" });

    const { sections } = deriveNoteList("en");
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].items[0].id).toBe("n1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/hooks/use-note-list.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement useNoteList.ts**

This migrates the filtering, sorting, and grouping logic from `useAppModel.ts`:

```ts
// apps/web/src/features/notes/hooks/useNoteList.ts
import { useMemo } from "react";
import type { NoteRecord } from "@markean/domain";
import { useNotesStore } from "../store/notes.store";
import { useEditorStore } from "../store/editor.store";
import { useFoldersStore } from "../store/folders.store";

export type NoteItem = {
  id: string;
  title: string;
  preview: string;
  date: string;
  folderName?: string;
};

export type NoteSection = {
  label: string;
  items: NoteItem[];
};

function formatNoteTitle(note: NoteRecord): string {
  const trimmed = note.title.trim();
  if (trimmed) return trimmed;
  const firstLine = note.bodyMd
    .split(/\n+/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return firstLine ?? "Untitled";
}

function summarizeNote(bodyMd: string): string {
  const summary = bodyMd.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  if (!summary) return "";
  return summary.length > 120 ? `${summary.slice(0, 120).trimEnd()}...` : summary;
}

function sortNotes(notes: NoteRecord[]): NoteRecord[] {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deriveNoteList(locale: string, t?: (key: string, params?: Record<string, string | number>) => string) {
  const notes = useNotesStore.getState().notes;
  const { activeFolderId, searchQuery } = useEditorStore.getState();
  const folders = useFoldersStore.getState().folders;
  const folderNameById = new Map(folders.map((f) => [f.id, f.name]));

  const query = searchQuery.trim().toLowerCase();
  const activeNotes = notes.filter((n) => !n.deletedAt);

  const filtered = query
    ? activeNotes.filter((n) => {
        const haystack = `${formatNoteTitle(n)}\n${n.bodyMd}\n${folderNameById.get(n.folderId) ?? ""}`.toLowerCase();
        return haystack.includes(query);
      })
    : activeNotes.filter((n) => n.folderId === activeFolderId);

  const sorted = sortNotes(filtered);
  const now = Date.now();

  const label7d = t ? t("noteList.group.7d") : "Last 7 Days";
  const label30d = t ? t("noteList.group.30d") : "Last 30 Days";
  const labelOlder = t ? t("noteList.group.older") : "Older";
  const dateLocale = locale.startsWith("zh") ? "zh-CN" : "en-US";

  const grouped = new Map<string, NoteItem[]>();
  for (const note of sorted) {
    const diffDays = Math.floor((now - new Date(note.updatedAt).getTime()) / 86_400_000);
    const label = diffDays <= 7 ? label7d : diffDays <= 30 ? label30d : labelOlder;
    const items = grouped.get(label) ?? [];
    items.push({
      id: note.id,
      title: formatNoteTitle(note),
      preview: summarizeNote(note.bodyMd),
      date: new Intl.DateTimeFormat(dateLocale, { month: "short", day: "numeric" }).format(new Date(note.updatedAt)),
      folderName: query ? folderNameById.get(note.folderId) : undefined,
    });
    grouped.set(label, items);
  }

  const sections: NoteSection[] = Array.from(grouped.entries()).map(([label, items]) => ({ label, items }));

  return { notesInScope: filtered, sections };
}

export function useNoteList(locale: string, t?: (key: string, params?: Record<string, string | number>) => string) {
  const notes = useNotesStore((s) => s.notes);
  const searchQuery = useEditorStore((s) => s.searchQuery);
  const activeFolderId = useEditorStore((s) => s.activeFolderId);
  const folders = useFoldersStore((s) => s.folders);

  return useMemo(
    () => deriveNoteList(locale, t),
    [notes, searchQuery, activeFolderId, folders, locale, t],
  );
}
```

- [ ] **Step 4: Implement useEditorActions.ts**

```ts
// apps/web/src/features/notes/hooks/useEditorActions.ts
import { useCallback } from "react";
import { markdownToPlainText } from "@markean/domain";
import { useNotesStore } from "../store/notes.store";
import { useSyncStore } from "../store/sync.store";
import { updateNote as persistUpdateNote } from "../persistence/notes.persistence";
import { getScheduler } from "../../app/bootstrap";

export function useEditorActions() {
  const updateNote = useNotesStore((s) => s.updateNote);

  const changeBody = useCallback((noteId: string, bodyMd: string) => {
    const title = bodyMd
      .split(/\n+/)
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find(Boolean) ?? "";

    updateNote(noteId, { bodyMd, title });
    useSyncStore.getState().markUnsynced();

    void persistUpdateNote(noteId, {
      bodyMd,
      bodyPlain: markdownToPlainText(bodyMd),
      title,
    });

    getScheduler()?.requestSync();
  }, [updateNote]);

  return { changeBody };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/hooks/use-note-list.test.ts`

Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/notes/hooks/ apps/web/test/hooks/
git commit -m "feat(web): add useNoteList and useEditorActions hooks"
```

---

## Task 13: Create feature index and move components

**Files:**
- Create: `apps/web/src/features/notes/index.ts`
- Move: `apps/web/src/components/*` → `apps/web/src/features/notes/components/`
- Create: `apps/web/src/features/notes/components/shared/SyncStatusBadge.tsx`

- [ ] **Step 1: Move component directories**

```bash
cd /Users/mizutanisubaru/mycode/Markean/apps/web/src
mkdir -p features/notes/components
mv components/desktop features/notes/components/
mv components/mobile features/notes/components/
mv components/editor features/notes/components/
mv components/shared features/notes/components/
rmdir components
```

- [ ] **Step 2: Create SyncStatusBadge.tsx**

```tsx
// apps/web/src/features/notes/components/shared/SyncStatusBadge.tsx
import { useSyncStore } from "../../store/sync.store";
import { useI18n } from "../../../../i18n";
import { SyncIcon } from "./Icons";

export function SyncStatusBadge() {
  const status = useSyncStore((s) => s.status);
  const { t } = useI18n();

  const label =
    status === "syncing"
      ? t("editor.syncing")
      : status === "unsynced" || status === "error"
        ? t("editor.unsynced")
        : t("editor.synced");

  return (
    <span className="sync-badge">
      <SyncIcon />
      {label}
    </span>
  );
}
```

- [ ] **Step 3: Create feature index**

```ts
// apps/web/src/features/notes/index.ts
export { useNotesStore } from "./store/notes.store";
export { useFoldersStore } from "./store/folders.store";
export { useEditorStore } from "./store/editor.store";
export { useSyncStore } from "./store/sync.store";
export { useNoteList } from "./hooks/useNoteList";
export { useEditorActions } from "./hooks/useEditorActions";
```

- [ ] **Step 4: Fix component import paths**

After moving, components' relative imports to `../../i18n` and `../../styles/` need to be updated to `../../../../i18n` and `../../../../styles/` respectively (3 extra levels deep now).

Update each file's imports:

**desktop/Editor.tsx** — change:
- `../../i18n` → `../../../../i18n`
- `../../lib/storage` → remove (no longer needed)
- `../editor/MarkeanEditor` → stays the same (relative within features/notes/components)
- `../shared/Icons` → stays the same
- Add import for `SyncStatusBadge` and use `NoteRecord` from domain instead of `WorkspaceNote`

**desktop/NoteList.tsx** — change:
- `../../i18n` → `../../../../i18n`
- `../shared/Icons` → stays the same

**desktop/Sidebar.tsx** — change:
- `../../i18n` → `../../../../i18n`
- `../shared/Icons` → stays the same

**mobile/MobileEditor.tsx** — change:
- `../../lib/storage` → remove
- `../../i18n` → `../../../../i18n`
- `../editor/MarkeanEditor` → stays the same
- `../shared/Icons` → stays the same
- `../../styles/mobile.css` → `../../../../styles/mobile.css`
- Use `NoteRecord` from domain instead of `WorkspaceNote`

**mobile/MobileFolders.tsx** — change:
- `../../i18n` → `../../../../i18n`
- `../shared/Icons` → stays the same
- `../../styles/mobile.css` → `../../../../styles/mobile.css`

**mobile/MobileNoteList.tsx** — change:
- `../../i18n` → `../../../../i18n`
- `../shared/Icons` → stays the same
- `../../styles/mobile.css` → `../../../../styles/mobile.css`

**editor/MarkeanEditor.tsx** — change:
- `../../styles/editor.css` → `../../../../styles/editor.css`

- [ ] **Step 5: Update Editor.tsx to use NoteRecord and SyncStatusBadge**

Replace the `EditorProps` type to use `NoteRecord` from domain:

```tsx
// apps/web/src/features/notes/components/desktop/Editor.tsx
import { useI18n } from "../../../../i18n";
import type { NoteRecord } from "@markean/domain";
import { MarkeanEditor } from "../editor/MarkeanEditor";
import { EmptyNoteIcon } from "../shared/Icons";
import { SyncStatusBadge } from "../shared/SyncStatusBadge";

type EditorProps = {
  note: NoteRecord | null;
  onChangeBody: (body: string) => void;
};

function formatModifiedDate(isoString: string, locale: string): string {
  return new Intl.DateTimeFormat(locale.startsWith("zh") ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));
}

export function Editor({ note, onChangeBody }: EditorProps) {
  const { t, locale } = useI18n();

  if (!note) {
    return (
      <div className="editor-pane">
        <div className="no-note">
          <EmptyNoteIcon />
          <span>{t("editor.noSelection")}</span>
          <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
            {t("editor.noSelectionHint")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-pane">
      <div className="editor-meta">
        <span>{formatModifiedDate(note.updatedAt, locale)}</span>
        <SyncStatusBadge />
      </div>
      <div className="editor-scroll">
        <MarkeanEditor key={note.id} content={note.bodyMd} onChange={onChangeBody} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Update MobileEditor.tsx to use NoteRecord**

```tsx
// apps/web/src/features/notes/components/mobile/MobileEditor.tsx
import type { NoteRecord } from "@markean/domain";
import { useI18n } from "../../../../i18n";
import { MarkeanEditor } from "../editor/MarkeanEditor";
import { BackIcon } from "../shared/Icons";
import "../../../../styles/mobile.css";

type MobileEditorProps = {
  folderName: string;
  note: NoteRecord;
  onBack: () => void;
  onChangeBody: (body: string) => void;
};

export function MobileEditor({ folderName, note, onBack, onChangeBody }: MobileEditorProps) {
  const { t } = useI18n();

  return (
    <section className="mobile-app">
      <div className="mobile-nav">
        <button type="button" className="mobile-nav-back" onClick={onBack}>
          <BackIcon />
          <span>{folderName}</span>
        </button>
        <div className="mobile-nav-title">{folderName}</div>
        <div className="mobile-nav-actions">
          <button type="button" onClick={onBack}>{t("mobile.done")}</button>
        </div>
      </div>
      <div className="mobile-editor">
        <MarkeanEditor key={note.id} content={note.bodyMd} onChange={onChangeBody} />
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Verify typecheck passes**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm --filter @markean/web exec tsc --noEmit 2>&1 | head -20`

Fix any remaining import path issues.

- [ ] **Step 8: Commit**

```bash
cd /Users/mizutanisubaru/mycode/Markean
git add apps/web/src/features/ apps/web/src/components/
git add -u apps/web/src/components/
git commit -m "refactor(web): move components to features/notes and update imports"
```

---

## Task 14: Rewrite App.tsx with stores

**Files:**
- Create: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/main.tsx`
- Delete: `apps/web/src/App.tsx` (old)
- Delete: `apps/web/src/useAppModel.ts`
- Delete: `apps/web/src/lib/storage.ts`
- Delete: `apps/web/src/lib/sync.ts`
- Delete: `apps/web/src/lib/bootstrap.ts`
- Delete: `apps/web/src/state/app-store.ts`

- [ ] **Step 1: Write new App.tsx**

```tsx
// apps/web/src/app/App.tsx
import { useCallback, useEffect, useMemo } from "react";
import type { NoteRecord } from "@markean/domain";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { createI18n, detectLocale, I18nProvider } from "../i18n";
import { useNotesStore } from "../features/notes/store/notes.store";
import { useFoldersStore } from "../features/notes/store/folders.store";
import { useEditorStore } from "../features/notes/store/editor.store";
import { useSyncStore } from "../features/notes/store/sync.store";
import { useNoteList } from "../features/notes/hooks/useNoteList";
import { useEditorActions } from "../features/notes/hooks/useEditorActions";
import { createNote as persistCreateNote } from "../features/notes/persistence/notes.persistence";
import { createFolder as persistCreateFolder } from "../features/notes/persistence/folders.persistence";
import { getScheduler } from "./bootstrap";
import { Editor } from "../features/notes/components/desktop/Editor";
import { NoteList } from "../features/notes/components/desktop/NoteList";
import { Sidebar } from "../features/notes/components/desktop/Sidebar";
import { MobileEditor } from "../features/notes/components/mobile/MobileEditor";
import { MobileFolders } from "../features/notes/components/mobile/MobileFolders";
import { MobileNoteList } from "../features/notes/components/mobile/MobileNoteList";

function AppShell() {
  const locale = detectLocale();
  const i18n = useMemo(() => createI18n(locale), [locale]);
  const isMobile = useMediaQuery("(max-width: 767px)");

  const notes = useNotesStore((s) => s.notes);
  const addNote = useNotesStore((s) => s.addNote);
  const rawFolders = useFoldersStore((s) => s.folders);
  const addFolderToStore = useFoldersStore((s) => s.addFolder);
  const activeFolderId = useEditorStore((s) => s.activeFolderId);
  const activeNoteId = useEditorStore((s) => s.activeNoteId);
  const searchQuery = useEditorStore((s) => s.searchQuery);
  const mobileView = useEditorStore((s) => s.mobileView);
  const newNoteId = useEditorStore((s) => s.newNoteId);
  const selectFolder = useEditorStore((s) => s.selectFolder);
  const selectNote = useEditorStore((s) => s.selectNote);
  const setSearchQuery = useEditorStore((s) => s.setSearchQuery);
  const setMobileView = useEditorStore((s) => s.setMobileView);
  const setNewNoteId = useEditorStore((s) => s.setNewNoteId);

  const { changeBody } = useEditorActions();
  const { notesInScope, sections } = useNoteList(i18n.locale, i18n.t);

  const activeFolders = useMemo(() => rawFolders.filter((f) => !f.deletedAt), [rawFolders]);
  const folders = useMemo(
    () =>
      activeFolders.map((f) => ({
        ...f,
        count: notes.filter((n) => n.folderId === f.id && !n.deletedAt).length,
      })),
    [activeFolders, notes],
  );
  const activeFolder = activeFolders.find((f) => f.id === activeFolderId) ?? activeFolders[0] ?? null;
  const activeNote: NoteRecord | null =
    notes.find((n) => n.id === activeNoteId && !n.deletedAt) ??
    notesInScope[0] ??
    null;

  useEffect(() => {
    document.documentElement.lang = i18n.locale.startsWith("zh") ? "zh-CN" : "en";
  }, [i18n.locale]);

  useEffect(() => {
    setMobileView(isMobile ? "folders" : "editor");
  }, [isMobile, setMobileView]);

  useEffect(() => {
    if (!newNoteId) return;
    const id = window.setTimeout(() => setNewNoteId(null), 1600);
    return () => window.clearTimeout(id);
  }, [newNoteId, setNewNoteId]);

  const handleSelectFolder = useCallback(
    (folderId: string) => {
      selectFolder(folderId);
      const firstNote = notes.find((n) => n.folderId === folderId && !n.deletedAt);
      if (firstNote) selectNote(firstNote.id);
      else selectNote("");
      setMobileView(isMobile ? "notes" : "editor");
    },
    [notes, selectFolder, selectNote, setMobileView, isMobile],
  );

  const handleCreateFolder = useCallback(() => {
    const defaultName = i18n.locale.startsWith("zh") ? "新建文件夹" : "New Folder";
    const name = window.prompt(defaultName, defaultName)?.trim();
    if (!name) return;

    const folder = addFolderToStore(name);
    selectFolder(folder.id);
    selectNote("");
    useSyncStore.getState().markUnsynced();
    void persistCreateFolder(folder);
    getScheduler()?.requestSync();
    setMobileView(isMobile ? "notes" : "editor");
  }, [addFolderToStore, selectFolder, selectNote, setMobileView, isMobile, i18n.locale]);

  const handleCreateNote = useCallback(() => {
    const folderId =
      isMobile && mobileView === "folders"
        ? activeFolders[0]?.id
        : activeFolder?.id ?? activeFolders[0]?.id;
    if (!folderId) return;

    const note = addNote(folderId);
    selectFolder(folderId);
    selectNote(note.id);
    setNewNoteId(note.id);
    setSearchQuery("");
    useSyncStore.getState().markUnsynced();
    void persistCreateNote(note);
    getScheduler()?.requestSync();
    setMobileView("editor");
  }, [addNote, activeFolder, activeFolders, isMobile, mobileView, selectFolder, selectNote, setNewNoteId, setSearchQuery, setMobileView]);

  const handleChangeBody = useCallback(
    (body: string) => {
      if (!activeNote) return;
      changeBody(activeNote.id, body);
    },
    [activeNote, changeBody],
  );

  const folderName = activeFolder?.name ?? (i18n.locale.startsWith("zh") ? "笔记" : "Notes");

  let content;
  if (isMobile) {
    if (mobileView === "editor" && activeNote) {
      content = (
        <MobileEditor
          folderName={folderName}
          note={activeNote}
          onBack={() => setMobileView("notes")}
          onChangeBody={handleChangeBody}
        />
      );
    } else if (mobileView === "notes") {
      content = (
        <MobileNoteList
          folderName={folderName}
          noteCount={notesInScope.length}
          sections={sections}
          searchQuery={searchQuery}
          onBack={() => setMobileView("folders")}
          onSearchChange={setSearchQuery}
          onSelectNote={(id) => { selectNote(id); setMobileView("editor"); }}
          onCreateNote={handleCreateNote}
        />
      );
    } else {
      content = (
        <MobileFolders
          folders={folders}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectFolder={handleSelectFolder}
          onCreateNote={handleCreateNote}
        />
      );
    }
  } else {
    content = (
      <div className="app">
        <Sidebar
          folders={folders}
          activeFolderId={activeFolder?.id ?? ""}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectFolder={handleSelectFolder}
          onCreateFolder={handleCreateFolder}
        />
        <NoteList
          folderName={searchQuery ? (i18n.locale.startsWith("zh") ? "搜索结果" : "Search results") : folderName}
          noteCount={notesInScope.length}
          sections={sections}
          activeNoteId={activeNote?.id ?? ""}
          searchQuery={searchQuery}
          newNoteId={newNoteId}
          onSelectNote={(id) => selectNote(id)}
          onCreateNote={handleCreateNote}
        />
        <Editor note={activeNote} onChangeBody={handleChangeBody} />
      </div>
    );
  }

  return <I18nProvider value={i18n}>{content}</I18nProvider>;
}

export function App() {
  return <AppShell />;
}
```

- [ ] **Step 2: Update main.tsx to use bootstrap**

```tsx
// apps/web/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { bootstrapApp } from "./app/bootstrap";
import "./styles/variables.css";
import "./styles/desktop.css";
import "./styles/mobile.css";
import "./styles/editor.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const root = createRoot(rootElement);

bootstrapApp()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error) => {
    console.error("Bootstrap failed:", error);
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}
```

- [ ] **Step 3: Delete old files**

```bash
cd /Users/mizutanisubaru/mycode/Markean/apps/web/src
rm -f App.tsx useAppModel.ts lib/storage.ts lib/sync.ts lib/bootstrap.ts state/app-store.ts
rmdir lib state 2>/dev/null || true
```

- [ ] **Step 4: Verify typecheck**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm --filter @markean/web exec tsc --noEmit 2>&1 | head -30`

Fix any type errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/mizutanisubaru/mycode/Markean
git add apps/web/src/app/App.tsx apps/web/src/main.tsx
git add -u apps/web/src/App.tsx apps/web/src/useAppModel.ts apps/web/src/lib/ apps/web/src/state/
git commit -m "refactor(web): rewrite App with zustand stores, remove useAppModel and localStorage layer"
```

---

## Task 15: Rewrite app.test.tsx for new architecture

**Files:**
- Modify: `apps/web/test/app.test.tsx`

The old tests rely on `useAppModel`, `localStorage`, and the old `App` import path. Rewrite to test the new store-based architecture.

- [ ] **Step 1: Rewrite app.test.tsx**

```tsx
// apps/web/test/app.test.tsx
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteRecord, FolderRecord } from "@markean/domain";
import { useNotesStore } from "../src/features/notes/store/notes.store";
import { useFoldersStore } from "../src/features/notes/store/folders.store";
import { useEditorStore } from "../src/features/notes/store/editor.store";
import { useSyncStore } from "../src/features/notes/store/sync.store";

vi.mock("../src/features/notes/components/editor/MarkeanEditor", () => ({
  MarkeanEditor: ({
    content,
    onChange,
  }: {
    content: string;
    onChange: (nextContent: string) => void;
  }) => (
    <textarea
      aria-label="Editor"
      value={content}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock("../src/app/bootstrap", () => ({
  getScheduler: () => ({ requestSync: vi.fn() }),
}));

vi.mock("../src/features/notes/persistence/notes.persistence", () => ({
  createNote: vi.fn().mockResolvedValue(undefined),
  updateNote: vi.fn().mockResolvedValue(undefined),
  getAllNotes: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/features/notes/persistence/folders.persistence", () => ({
  createFolder: vi.fn().mockResolvedValue(undefined),
  getAllFolders: vi.fn().mockResolvedValue([]),
}));

import { App } from "../src/app/App";

type MatchMediaOptions = { matches: boolean };

function mockMatchMedia({ matches }: MatchMediaOptions) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const defaultFolder: FolderRecord = {
  id: "notes",
  name: "Notes",
  sortOrder: 0,
  currentRevision: 1,
  updatedAt: "2026-04-20T09:00:00.000Z",
  deletedAt: null,
};

const welcomeNote: NoteRecord = {
  id: "welcome-note",
  folderId: "notes",
  title: "Welcome to Markean",
  bodyMd: "# Welcome to Markean\n\nHello!",
  bodyPlain: "Welcome to Markean Hello!",
  currentRevision: 1,
  updatedAt: "2026-04-20T09:00:00.000Z",
  deletedAt: null,
};

function seedStores(options?: { folders?: FolderRecord[]; notes?: NoteRecord[] }) {
  const folders = options?.folders ?? [defaultFolder];
  const notes = options?.notes ?? [welcomeNote];
  useFoldersStore.getState().loadFolders(folders);
  useNotesStore.getState().loadNotes(notes);
  const activeFolder = folders.find((f) => !f.deletedAt);
  if (activeFolder) {
    useEditorStore.getState().selectFolder(activeFolder.id);
    const firstNote = notes.find((n) => n.folderId === activeFolder.id && !n.deletedAt);
    if (firstNote) useEditorStore.getState().selectNote(firstNote.id);
  }
}

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useNotesStore.setState({ notes: [] });
    useFoldersStore.setState({ folders: [] });
    useEditorStore.setState({ activeFolderId: "", activeNoteId: "", searchQuery: "", mobileView: "folders", newNoteId: null });
    useSyncStore.setState({ status: "idle", isOnline: true, lastSyncedAt: null });
  });

  it("renders the desktop workspace with a note", () => {
    mockMatchMedia({ matches: false });
    seedStores();

    render(<App />);

    expect(screen.getByText("Folders")).toBeInTheDocument();
    expect(screen.getByText("Welcome to Markean")).toBeInTheDocument();
  });

  it("renders the mobile folders view", () => {
    mockMatchMedia({ matches: true });
    seedStores();

    render(<App />);

    expect(screen.getAllByText("Folders")).toHaveLength(2);
  });

  it("creates a new note when clicking New Note", async () => {
    mockMatchMedia({ matches: false });
    seedStores();

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "New Note" }));

    await waitFor(() => {
      expect(useNotesStore.getState().notes).toHaveLength(2);
      expect(useSyncStore.getState().status).toBe("unsynced");
    });
  });

  it("updates note body when editing", async () => {
    mockMatchMedia({ matches: false });
    seedStores();

    render(<App />);

    fireEvent.change(screen.getByRole("textbox", { name: "Editor" }), {
      target: { value: "# Updated content" },
    });

    await waitFor(() => {
      const note = useNotesStore.getState().notes.find((n) => n.id === "welcome-note");
      expect(note?.bodyMd).toBe("# Updated content");
    });
  });
});
```

- [ ] **Step 2: Run new app tests**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web test/app.test.tsx`

Expected: All 4 tests PASS.

- [ ] **Step 3: Update remaining component tests**

The existing component tests (`sidebar.test.tsx`, `note-list.test.tsx`, `mobile-components.test.tsx`, `markean-editor.test.tsx`) import from old paths. Update their imports:

- `../src/components/desktop/Sidebar` → `../src/features/notes/components/desktop/Sidebar`
- `../src/components/desktop/NoteList` → `../src/features/notes/components/desktop/NoteList`
- `../src/components/mobile/*` → `../src/features/notes/components/mobile/*`
- `../src/components/editor/MarkeanEditor` → `../src/features/notes/components/editor/MarkeanEditor`

Any test that imported `WorkspaceNote` or `SyncStatus` from `../src/lib/storage` should be updated to use `NoteRecord` from `@markean/domain` and `useSyncStore` respectively.

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run --project @markean/web`

Expected: All tests PASS.

- [ ] **Step 5: Run full monorepo typecheck**

Run: `cd /Users/mizutanisubaru/mycode/Markean && pnpm -r run typecheck 2>&1 | tail -20`

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/mizutanisubaru/mycode/Markean
git add apps/web/test/
git commit -m "test(web): rewrite app tests for zustand store architecture"
```

---

## Task 16: Final cleanup and full verification

- [ ] **Step 1: Verify no old file references remain**

```bash
cd /Users/mizutanisubaru/mycode/Markean
grep -r "useAppModel" apps/web/src/ || echo "OK: no useAppModel references"
grep -r "lib/storage" apps/web/src/ || echo "OK: no lib/storage references"
grep -r "lib/sync" apps/web/src/ || echo "OK: no lib/sync references"
grep -r "lib/bootstrap" apps/web/src/ || echo "OK: no lib/bootstrap references"
grep -r "app-store" apps/web/src/ || echo "OK: no app-store references"
```

- [ ] **Step 2: Verify old files are deleted**

```bash
ls apps/web/src/useAppModel.ts apps/web/src/lib/storage.ts apps/web/src/lib/sync.ts apps/web/src/lib/bootstrap.ts apps/web/src/state/app-store.ts apps/web/src/App.tsx 2>&1
```

Expected: All "No such file or directory".

- [ ] **Step 3: Run full monorepo tests**

```bash
cd /Users/mizutanisubaru/mycode/Markean && pnpm vitest run
```

Expected: All projects pass.

- [ ] **Step 4: Verify the directory structure matches the design**

```bash
find apps/web/src -type f | sort
```

Verify it matches the planned structure from the design spec.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git status
# Only commit if there are changes
git commit -m "chore(web): final cleanup for frontend-backend integration"
```
