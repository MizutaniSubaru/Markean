import "fake-indexeddb/auto";

import type { FolderRecord, NoteRecord } from "@markean/domain";
import { queueChange } from "@markean/sync-core";
import { createWebDatabase, type MarkeanWebDatabase } from "@markean/storage-web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initDb, resetDbForTests } from "../../src/features/notes/persistence/db";
import { createSyncService } from "../../src/features/notes/sync/sync.service";
import { useFoldersStore } from "../../src/features/notes/store/folders.store";
import { useNotesStore } from "../../src/features/notes/store/notes.store";
import { useSyncStore } from "../../src/features/notes/store/sync.store";

const localNote: NoteRecord = {
  id: "note_local",
  folderId: "folder_local",
  title: "Local note",
  bodyMd: "# Local",
  bodyPlain: "Local",
  currentRevision: 1,
  updatedAt: "2026-04-21T09:00:00.000Z",
  deletedAt: null,
};

const pulledNote: NoteRecord = {
  id: "note_pulled",
  folderId: "folder_pulled",
  title: "Pulled note",
  bodyMd: "# Pulled",
  bodyPlain: "Pulled",
  currentRevision: 7,
  updatedAt: "2026-04-22T10:00:00.000Z",
  deletedAt: null,
};

const localFolder: FolderRecord = {
  id: "folder_local",
  name: "Local",
  sortOrder: 0,
  currentRevision: 1,
  updatedAt: "2026-04-21T09:00:00.000Z",
  deletedAt: null,
};

const pulledFolder: FolderRecord = {
  id: "folder_pulled",
  name: "Pulled",
  sortOrder: 1,
  currentRevision: 8,
  updatedAt: "2026-04-22T10:00:00.000Z",
  deletedAt: null,
};

type Conflict = { entityType: string; entityId: string; serverRevision: number };

function createMockApiClient(options?: { conflicts?: Conflict[] }) {
  return {
    bootstrap: vi.fn(),
    syncPush: vi.fn().mockResolvedValue({ accepted: [], conflicts: options?.conflicts ?? [] }),
    syncPull: vi.fn().mockResolvedValue({ nextCursor: 1, events: [] }),
    restoreNote: vi.fn(),
    listTrash: vi.fn(),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function resetStores(): void {
  useNotesStore.setState({ notes: [] });
  useFoldersStore.setState({ folders: [] });
  useSyncStore.setState({
    status: "idle",
    isOnline: true,
    lastSyncedAt: null,
  });
}

describe("sync.service", () => {
  let db: MarkeanWebDatabase;

  beforeEach(() => {
    db = createWebDatabase(`test-sync-service-${crypto.randomUUID()}`);
    resetDbForTests();
    initDb(db);
    resetStores();
  });

  afterEach(async () => {
    vi.useRealTimers();
    resetStores();
    await db.delete();
    resetDbForTests();
  });

  it("runs a sync cycle and transitions status idle -> syncing -> idle", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));
    const apiClient = createMockApiClient();
    apiClient.syncPull.mockImplementation(async () => {
      expect(useSyncStore.getState().status).toBe("syncing");
      return { nextCursor: 1, events: [] };
    });
    const service = createSyncService(apiClient);

    expect(useSyncStore.getState().status).toBe("idle");

    await service.executeSyncCycle();

    expect(useSyncStore.getState()).toMatchObject({
      status: "idle",
      lastSyncedAt: "2026-04-27T12:34:56.789Z",
    });
  });

  it("sets error status on failure without marking lastSyncedAt", async () => {
    const apiClient = createMockApiClient();
    apiClient.syncPull.mockRejectedValue(new Error("network failed"));
    const service = createSyncService(apiClient);

    await service.executeSyncCycle();

    expect(useSyncStore.getState()).toMatchObject({
      status: "error",
      lastSyncedAt: null,
    });
  });

  it("hydrates notes store after pull", async () => {
    const apiClient = createMockApiClient();
    apiClient.syncPull.mockResolvedValue({
      nextCursor: 2,
      events: [
        {
          cursor: 2,
          entityType: "note",
          entityId: pulledNote.id,
          operation: "create",
          revisionNumber: pulledNote.currentRevision,
          sourceDeviceId: "server_device",
          entity: pulledNote,
        },
      ],
    });
    const service = createSyncService(apiClient);

    await service.executeSyncCycle();

    expect(useNotesStore.getState().notes).toEqual([pulledNote]);
  });

  it("hydrates folders store after sync", async () => {
    const apiClient = createMockApiClient();
    apiClient.syncPull.mockResolvedValue({
      nextCursor: 2,
      events: [
        {
          cursor: 2,
          entityType: "folder",
          entityId: pulledFolder.id,
          operation: "create",
          revisionNumber: pulledFolder.currentRevision,
          sourceDeviceId: "server_device",
          entity: pulledFolder,
        },
      ],
    });
    const service = createSyncService(apiClient);

    await service.executeSyncCycle();

    expect(useFoldersStore.getState().folders).toEqual([pulledFolder]);
  });

  it("skips stale store and status updates when sync becomes inactive before pull resolves", async () => {
    const pullResult = createDeferred<{
      nextCursor: number;
      events: Array<{
        cursor: number;
        entityType: "note";
        entityId: string;
        operation: "create";
        revisionNumber: number;
        sourceDeviceId: string;
        entity: NoteRecord;
      }>;
    }>();
    let active = true;
    const apiClient = createMockApiClient();
    apiClient.syncPull.mockReturnValue(pullResult.promise);
    const service = createSyncService(apiClient, {
      shouldApply: () => active,
    });

    const cycle = service.executeSyncCycle();
    await vi.waitFor(() => expect(apiClient.syncPull).toHaveBeenCalledTimes(1));
    expect(useSyncStore.getState().status).toBe("syncing");

    active = false;
    pullResult.resolve({
      nextCursor: 2,
      events: [
        {
          cursor: 2,
          entityType: "note",
          entityId: pulledNote.id,
          operation: "create",
          revisionNumber: pulledNote.currentRevision,
          sourceDeviceId: "server_device",
          entity: pulledNote,
        },
      ],
    });
    await cycle;

    await expect(db.notes.get(pulledNote.id)).resolves.toBeUndefined();
    await expect(db.syncState.get("syncCursor")).resolves.toBeUndefined();
    expect(useNotesStore.getState().notes).toEqual([]);
    expect(useFoldersStore.getState().folders).toEqual([]);
    expect(useSyncStore.getState().status).not.toBe("syncing");
    expect(useSyncStore.getState().lastSyncedAt).toBeNull();
  });

  it("creates a conflict copy when sync returns a note conflict", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));
    await db.notes.put(localNote);
    await queueChange(db, {
      entityType: "note",
      entityId: localNote.id,
      operation: "update",
      baseRevision: localNote.currentRevision,
    });
    const apiClient = createMockApiClient({
      conflicts: [{ entityType: "note", entityId: localNote.id, serverRevision: 5 }],
    });
    const service = createSyncService(apiClient);

    await service.executeSyncCycle();

    const notes = useNotesStore.getState().notes;
    expect(notes).toHaveLength(2);
    expect(notes).toContainEqual(localNote);
    const copy = notes.find((note) => note.id !== localNote.id);
    expect(copy).toMatchObject({
      folderId: localNote.folderId,
      title: "Local note (conflict copy)",
      bodyMd: localNote.bodyMd,
      bodyPlain: localNote.bodyPlain,
      currentRevision: 0,
      updatedAt: "2026-04-27T12:34:56.789Z",
      deletedAt: null,
    });
    expect(copy!.id).toMatch(/^note_/);
    await expect(db.notes.get(copy!.id)).resolves.toEqual(copy);
    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entityType: "note",
      entityId: copy!.id,
      operation: "create",
      baseRevision: 0,
    });
    expect(useSyncStore.getState()).toMatchObject({
      status: "unsynced",
      lastSyncedAt: null,
    });
  });

  it("preserves the local edit in the conflict copy before pulling server events", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));
    await db.notes.put(localNote);
    await queueChange(db, {
      entityType: "note",
      entityId: localNote.id,
      operation: "update",
      baseRevision: localNote.currentRevision,
    });
    const serverNote: NoteRecord = {
      ...localNote,
      title: "Server note",
      bodyMd: "# Server",
      bodyPlain: "Server",
      currentRevision: 5,
      updatedAt: "2026-04-26T09:00:00.000Z",
    };
    const apiClient = createMockApiClient({
      conflicts: [{ entityType: "note", entityId: localNote.id, serverRevision: 5 }],
    });
    apiClient.syncPull.mockResolvedValue({
      nextCursor: 6,
      events: [
        {
          cursor: 6,
          entityType: "note",
          entityId: localNote.id,
          operation: "update",
          revisionNumber: serverNote.currentRevision,
          sourceDeviceId: "server_device",
          entity: serverNote,
        },
      ],
    });
    const service = createSyncService(apiClient);

    await service.executeSyncCycle();

    expect(await db.notes.get(localNote.id)).toEqual(serverNote);
    const copy = useNotesStore
      .getState()
      .notes.find((note) => note.id !== localNote.id);
    expect(copy).toMatchObject({
      folderId: localNote.folderId,
      title: "Local note (conflict copy)",
      bodyMd: localNote.bodyMd,
      bodyPlain: localNote.bodyPlain,
      currentRevision: 0,
      updatedAt: "2026-04-27T12:34:56.789Z",
      deletedAt: null,
    });
  });

  it("marks error and skips pull when conflict handling fails", async () => {
    await db.notes.put(localNote);
    await queueChange(db, {
      entityType: "note",
      entityId: localNote.id,
      operation: "update",
      baseRevision: localNote.currentRevision,
    });
    db.pendingChanges.hook("creating", () => {
      throw new Error("conflict copy failed");
    });
    const apiClient = createMockApiClient({
      conflicts: [{ entityType: "note", entityId: localNote.id, serverRevision: 5 }],
    });
    const service = createSyncService(apiClient);

    await service.executeSyncCycle();

    expect(apiClient.syncPull).not.toHaveBeenCalled();
    expect(useSyncStore.getState()).toMatchObject({
      status: "error",
      lastSyncedAt: null,
    });
  });

  it("calls syncPull and updates the DB sync cursor on success", async () => {
    const apiClient = createMockApiClient();
    apiClient.syncPull.mockResolvedValue({ nextCursor: 9, events: [] });
    const service = createSyncService(apiClient);

    await service.executeSyncCycle();

    expect(apiClient.syncPull).toHaveBeenCalledWith(0);
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "9",
    });
  });

  it("marks unsynced when pending changes remain after sync", async () => {
    await db.notes.put(localNote);
    await queueChange(db, {
      entityType: "note",
      entityId: localNote.id,
      operation: "update",
      baseRevision: localNote.currentRevision,
    });
    const apiClient = createMockApiClient();
    apiClient.syncPush.mockResolvedValue({ accepted: [], conflicts: [] });
    const service = createSyncService(apiClient);

    await service.executeSyncCycle();

    await expect(db.pendingChanges.toArray()).resolves.toHaveLength(1);
    expect(useSyncStore.getState()).toMatchObject({
      status: "unsynced",
      lastSyncedAt: null,
    });
  });

  it("preserves lastSyncedAt when pending changes remain after sync", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));
    useSyncStore.setState({
      status: "idle",
      isOnline: true,
      lastSyncedAt: "2026-04-20T00:00:00.000Z",
    });
    await db.notes.put(localNote);
    await queueChange(db, {
      entityType: "note",
      entityId: localNote.id,
      operation: "update",
      baseRevision: localNote.currentRevision,
    });
    const apiClient = createMockApiClient();
    apiClient.syncPush.mockResolvedValue({ accepted: [], conflicts: [] });
    const service = createSyncService(apiClient);

    await service.executeSyncCycle();

    await expect(db.pendingChanges.toArray()).resolves.toHaveLength(1);
    expect(useSyncStore.getState()).toMatchObject({
      status: "unsynced",
      lastSyncedAt: "2026-04-20T00:00:00.000Z",
    });
  });

  it("pushes pending changes before pulling", async () => {
    await db.folders.put(localFolder);
    await db.notes.put(localNote);
    await queueChange(db, {
      entityType: "note",
      entityId: localNote.id,
      operation: "update",
      baseRevision: localNote.currentRevision,
    });
    const apiClient = createMockApiClient();
    apiClient.syncPush.mockResolvedValue({
      accepted: [{ acceptedRevision: 2, cursor: 11 }],
      conflicts: [],
    });
    apiClient.syncPull.mockResolvedValue({ nextCursor: 12, events: [] });
    const service = createSyncService(apiClient);

    await service.executeSyncCycle();

    expect(apiClient.syncPush).toHaveBeenCalledWith({
      deviceId: expect.stringMatching(/^dev_/),
      changes: [
        {
          clientChangeId: expect.stringMatching(/^chg_/),
          entityType: "note",
          entityId: localNote.id,
          operation: "update",
          baseRevision: localNote.currentRevision,
          payload: {
            folderId: localNote.folderId,
            title: localNote.title,
            bodyMd: localNote.bodyMd,
          },
        },
      ],
    });
    expect(apiClient.syncPull).toHaveBeenCalledWith(11);
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "12",
    });
  });

  it("shares one in-flight sync cycle across concurrent calls", async () => {
    await db.notes.put(localNote);
    await queueChange(db, {
      entityType: "note",
      entityId: localNote.id,
      operation: "update",
      baseRevision: localNote.currentRevision,
    });
    const apiClient = createMockApiClient();
    const pushResult = createDeferred<{
      accepted: Array<{ acceptedRevision: number; cursor: number }>;
      conflicts: Conflict[];
    }>();
    apiClient.syncPush.mockReturnValue(pushResult.promise);
    apiClient.syncPull.mockResolvedValue({ nextCursor: 4, events: [] });
    const service = createSyncService(apiClient);

    const first = service.executeSyncCycle();
    const second = service.executeSyncCycle();
    await vi.waitFor(() => expect(apiClient.syncPush).toHaveBeenCalledTimes(1));

    pushResult.resolve({
      accepted: [{ acceptedRevision: 2, cursor: 3 }],
      conflicts: [],
    });
    await Promise.all([first, second]);

    expect(apiClient.syncPush).toHaveBeenCalledTimes(1);
    expect(apiClient.syncPull).toHaveBeenCalledTimes(1);
    expect(useSyncStore.getState().status).toBe("idle");
  });

  it("resets the in-flight guard after a failed sync cycle", async () => {
    await db.notes.put(localNote);
    await queueChange(db, {
      entityType: "note",
      entityId: localNote.id,
      operation: "update",
      baseRevision: localNote.currentRevision,
    });
    const apiClient = createMockApiClient();
    apiClient.syncPush
      .mockResolvedValueOnce({ accepted: [], conflicts: [] })
      .mockResolvedValueOnce({
        accepted: [{ acceptedRevision: 2, cursor: 2 }],
        conflicts: [],
      });
    apiClient.syncPull.mockRejectedValueOnce(new Error("network failed"));
    const service = createSyncService(apiClient);

    await service.executeSyncCycle();

    expect(useSyncStore.getState().status).toBe("error");
    apiClient.syncPull.mockResolvedValueOnce({ nextCursor: 2, events: [] });

    await service.executeSyncCycle();

    expect(apiClient.syncPush).toHaveBeenCalledTimes(2);
    expect(apiClient.syncPull).toHaveBeenCalledTimes(2);
    expect(useSyncStore.getState().status).toBe("idle");
  });
});
