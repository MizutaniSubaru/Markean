import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebDatabase } from "@markean/storage-web";
import type { MarkeanWebDatabase } from "@markean/storage-web";
import { queueChange } from "@markean/sync-core";
import { initDb } from "../../src/features/notes/persistence/db";
import { useSyncStore } from "../../src/features/notes/store/sync.store";
import { useNotesStore } from "../../src/features/notes/store/notes.store";
import { useFoldersStore } from "../../src/features/notes/store/folders.store";
import { createSyncService } from "../../src/features/notes/sync/sync.service";

function createMockApiClient(options?: {
  conflicts?: Array<{ entityType: string; entityId: string; serverRevision: number }>;
}) {
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
    useSyncStore.setState({ status: "idle", isOnline: true, lastSyncedAt: null });
    useNotesStore.setState({ notes: [] });
    useFoldersStore.setState({ folders: [] });
    await db.delete();
  });

  it("runs a sync cycle and transitions status idle -> syncing -> idle", async () => {
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
    apiClient.syncPull.mockRejectedValue(new Error("network"));
    const service = createSyncService(apiClient);

    await db.notes.put({
      id: "note_1",
      folderId: "folder_1",
      title: "Local",
      bodyMd: "body",
      bodyPlain: "body",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    });
    await queueChange(db, {
      entityType: "note",
      entityId: "note_1",
      operation: "update",
      baseRevision: 1,
    });

    await service.executeSyncCycle();

    expect(useSyncStore.getState().status).toBe("error");
  });

  it("hydrates notes and folders stores after pull", async () => {
    const apiClient = createMockApiClient();
    const service = createSyncService(apiClient);

    await db.notes.put({
      id: "note_from_db",
      folderId: "folder_1",
      title: "DB note",
      bodyMd: "body",
      bodyPlain: "body",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    });

    await db.folders.put({
      id: "folder_1",
      name: "Folder",
      sortOrder: 0,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    });

    await service.executeSyncCycle();

    expect(useNotesStore.getState().notes).toHaveLength(1);
    expect(useNotesStore.getState().notes[0].id).toBe("note_from_db");
    expect(useFoldersStore.getState().folders).toHaveLength(1);
    expect(useFoldersStore.getState().folders[0].id).toBe("folder_1");
  });

  it("creates conflict copies before hydrating stores", async () => {
    const apiClient = createMockApiClient({
      conflicts: [{ entityType: "note", entityId: "note_1", serverRevision: 5 }],
    });
    const service = createSyncService(apiClient);

    await db.notes.put({
      id: "note_1",
      folderId: "folder_1",
      title: "Local",
      bodyMd: "# Local",
      bodyPlain: "Local",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    });
    await queueChange(db, {
      entityType: "note",
      entityId: "note_1",
      operation: "update",
      baseRevision: 1,
    });

    await service.executeSyncCycle();

    const notes = useNotesStore.getState().notes;
    expect(notes).toHaveLength(2);
    expect(notes.some((note) => note.title.includes("(conflict copy)"))).toBe(true);
  });
});
