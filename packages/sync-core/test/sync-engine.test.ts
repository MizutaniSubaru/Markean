import "fake-indexeddb/auto";

import type { FolderRecord, NoteRecord, PendingChange } from "@markean/domain";
import { describe, expect, it } from "vitest";
import { createWebDatabase } from "../../storage-web/src/index";
import { getDeviceId, pullChanges, pushChanges, queueChange } from "../src/index";

type QueuedPendingChange = PendingChange & { queuedOrder: number };
type MaybeQueuedPendingChange = PendingChange & { queuedOrder?: number };
type PushApiClient = Parameters<typeof pushChanges>[1];
type PushInput = Parameters<PushApiClient["syncPush"]>[0];

describe("sync engine queue", () => {
  it("accepts structural databases without syncState delete for queueing changes", async () => {
    const pendingChanges: PendingChange[] = [];
    const structuralDb = {
      pendingChanges: {
        async toArray() {
          return pendingChanges;
        },
        where() {
          return {
            anyOf() {
              return {
                async delete() {
                  return 0;
                },
              };
            },
          };
        },
        async put(value: PendingChange) {
          pendingChanges.push(value);
        },
      },
      notes: {
        async get() {
          return undefined;
        },
        async put() {
          return undefined;
        },
        async update() {
          return 0;
        },
      },
      folders: {
        async get() {
          return undefined;
        },
        async put() {
          return undefined;
        },
        async update() {
          return 0;
        },
      },
      syncState: {
        async get() {
          return undefined;
        },
        async put() {
          return undefined;
        },
      },
    } satisfies Parameters<typeof queueChange>[0];

    await queueChange(structuralDb, {
      entityType: "note",
      entityId: "note_1",
      operation: "update",
      baseRevision: 1,
    });

    expect(pendingChanges).toHaveLength(1);
  });

  it("queues a pending change via the shared domain helper", async () => {
    const db = createWebDatabase("test-markean-sync");

    await queueChange(db, {
      entityType: "note",
      entityId: "note_1",
      operation: "update",
      baseRevision: 1,
    });

    const [change] = await db.pendingChanges.toArray();

    expect(change?.entityType).toBe("note");
    expect(change?.entityId).toBe("note_1");
    expect(change?.operation).toBe("update");
    expect(change?.baseRevision).toBe(1);
    expect(change?.clientChangeId).toMatch(/^chg_/);
  });

  it("queues pending changes with increasing queued order", async () => {
    const db = createWebDatabase(`test-markean-queue-order-${crypto.randomUUID()}`);

    await queueChange(db, {
      entityType: "note",
      entityId: "note_first",
      operation: "create",
      baseRevision: 0,
    });
    await queueChange(db, {
      entityType: "note",
      entityId: "note_second",
      operation: "update",
      baseRevision: 1,
    });

    const changes = (await db.pendingChanges.toArray()) as MaybeQueuedPendingChange[];
    const first = changes.find((change) => change.entityId === "note_first");
    const second = changes.find((change) => change.entityId === "note_second");

    expect(first?.queuedOrder).toEqual(expect.any(Number));
    expect(second?.queuedOrder).toEqual(expect.any(Number));
    expect(second!.queuedOrder).toBeGreaterThan(first!.queuedOrder!);
  });

  it("persists and reuses a generated device id", async () => {
    const db = createWebDatabase("test-markean-device-id");

    const firstId = await getDeviceId(db);
    const secondId = await getDeviceId(db);
    const stored = await db.syncState.get("deviceId");

    expect(firstId).toMatch(/^dev_/);
    expect(secondId).toBe(firstId);
    expect(stored?.value).toBe(firstId);
  });

  it("does not create a device id when shouldApply is false", async () => {
    const db = createWebDatabase(`test-markean-device-id-cancel-${crypto.randomUUID()}`);

    const deviceId = await getDeviceId(db, { shouldApply: () => false });

    expect(deviceId).toBeNull();
    await expect(db.syncState.get("deviceId")).resolves.toBeUndefined();
  });

  it("removes a generated device id when shouldApply becomes false while persisting it", async () => {
    const db = createWebDatabase(`test-markean-device-id-inflight-cancel-${crypto.randomUUID()}`);
    const originalPut = db.syncState.put.bind(db.syncState);
    let active = true;

    db.syncState.put = (async (value) => {
      const result = await originalPut(value);
      if (value.key === "deviceId") {
        active = false;
      }
      return result;
    }) as typeof db.syncState.put;

    const deviceId = await getDeviceId(db, { shouldApply: () => active });

    expect(deviceId).toBeNull();
    await expect(db.syncState.get("deviceId")).resolves.toBeUndefined();
  });

  it("does not delete a concurrent device id when stale rollback races with a current write", async () => {
    const db = createWebDatabase(`test-markean-device-id-concurrent-cancel-${crypto.randomUUID()}`);
    const originalGet = db.syncState.get.bind(db.syncState);
    const originalPut = db.syncState.put.bind(db.syncState);
    let active = true;
    let staleDeviceId: string | null = null;
    let resolveStalePut!: () => void;
    const stalePut = new Promise<void>((resolve) => {
      resolveStalePut = resolve;
    });
    let currentWrite: Promise<unknown> | null = null;
    let scheduledCurrentWrite: ReturnType<typeof setTimeout> | null = null;

    db.syncState.put = (async (value) => {
      const result = await originalPut(value);
      if (value.key === "deviceId" && value.value !== "dev_current") {
        staleDeviceId = value.value;
        active = false;
        scheduledCurrentWrite = setTimeout(() => {
          currentWrite ??= originalPut({ key: "deviceId", value: "dev_current" });
        }, 0);
        resolveStalePut();
      }
      return result;
    }) as typeof db.syncState.put;
    db.syncState.get = (async (key: string) => {
      const result = await originalGet(key);
      if (
        key === "deviceId" &&
        !active &&
        result?.value === staleDeviceId &&
        !currentWrite
      ) {
        if (scheduledCurrentWrite) {
          clearTimeout(scheduledCurrentWrite);
        }
        currentWrite = originalPut({ key: "deviceId", value: "dev_current" });
        await currentWrite;
      }
      return result;
    }) as typeof db.syncState.get;

    const staleDeviceIdResult = getDeviceId(db, { shouldApply: () => active });
    await stalePut;
    const deviceId = await staleDeviceIdResult;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await currentWrite;

    expect(deviceId).toBeNull();
    await expect(db.syncState.get("deviceId")).resolves.toEqual({
      key: "deviceId",
      value: "dev_current",
    });
  });

  it("reconciles the originating device with accepted server state after push", async () => {
    const db = createWebDatabase(`test-markean-push-reconcile-${crypto.randomUUID()}`);

    await db.notes.put({
      id: "note_1",
      folderId: "folder_1",
      title: "Local title",
      bodyMd: "Local body",
      bodyPlain: "Local body",
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

    const apiClient = {
      async syncPush() {
        return {
          accepted: [{ acceptedRevision: 2, cursor: 10 }],
          conflicts: [],
        };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1");

    expect(await db.pendingChanges.toArray()).toHaveLength(0);
    expect(await db.syncState.get("syncCursor")).toEqual({ key: "syncCursor", value: "10" });
    await expect(db.notes.get("note_1")).resolves.toMatchObject({
      currentRevision: 2,
    });
  });

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

  it("pushes note create before update when client change ids sort the other way", async () => {
    const db = createWebDatabase(`test-markean-push-order-create-update-${crypto.randomUUID()}`);
    const note: NoteRecord = {
      id: "note_ordered",
      folderId: "folder_1",
      title: "Edited before first sync",
      bodyMd: "Edited before first sync",
      bodyPlain: "Edited before first sync",
      currentRevision: 0,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await db.notes.put(note);
    await db.pendingChanges.bulkPut([
      {
        clientChangeId: "chg_z_create",
        entityType: "note",
        entityId: note.id,
        operation: "create",
        baseRevision: 0,
        queuedOrder: 1,
      },
      {
        clientChangeId: "chg_a_update",
        entityType: "note",
        entityId: note.id,
        operation: "update",
        baseRevision: 0,
        queuedOrder: 2,
      },
    ] satisfies QueuedPendingChange[]);

    let pushedOperations: string[] = [];
    const apiClient: PushApiClient = {
      async syncPush(input: PushInput) {
        pushedOperations = input.changes.map((change) => change.operation);
        return { accepted: [], conflicts: [] };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1");

    expect(pushedOperations).toEqual(["create", "update"]);
  });

  it("pushes note create before delete when client change ids sort the other way", async () => {
    const db = createWebDatabase(`test-markean-push-order-create-delete-${crypto.randomUUID()}`);
    const note: NoteRecord = {
      id: "note_deleted_before_sync",
      folderId: "folder_1",
      title: "Deleted before first sync",
      bodyMd: "Deleted before first sync",
      bodyPlain: "Deleted before first sync",
      currentRevision: 0,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: "2026-04-21T09:05:00.000Z",
    };
    await db.notes.put(note);
    await db.pendingChanges.bulkPut([
      {
        clientChangeId: "chg_z_create",
        entityType: "note",
        entityId: note.id,
        operation: "create",
        baseRevision: 0,
        queuedOrder: 1,
      },
      {
        clientChangeId: "chg_a_delete",
        entityType: "note",
        entityId: note.id,
        operation: "delete",
        baseRevision: 0,
        queuedOrder: 2,
      },
    ] satisfies QueuedPendingChange[]);

    let pushedOperations: string[] = [];
    const apiClient: PushApiClient = {
      async syncPush(input: PushInput) {
        pushedOperations = input.changes.map((change) => change.operation);
        return { accepted: [], conflicts: [] };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1");

    expect(pushedOperations).toEqual(["create", "delete"]);
  });

  it("pushes folder create before child note create and reconciles accepted revisions in pushed order", async () => {
    const db = createWebDatabase(`test-markean-push-order-folder-note-${crypto.randomUUID()}`);
    const folder: FolderRecord = {
      id: "folder_parent",
      name: "Parent",
      sortOrder: 1,
      currentRevision: 0,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    const note: NoteRecord = {
      id: "note_child",
      folderId: folder.id,
      title: "Child",
      bodyMd: "Child",
      bodyPlain: "Child",
      currentRevision: 0,
      updatedAt: "2026-04-21T09:01:00.000Z",
      deletedAt: null,
    };
    await db.folders.put(folder);
    await db.notes.put(note);
    await db.pendingChanges.bulkPut([
      {
        clientChangeId: "chg_z_folder_create",
        entityType: "folder",
        entityId: folder.id,
        operation: "create",
        baseRevision: 0,
        queuedOrder: 1,
      },
      {
        clientChangeId: "chg_a_note_create",
        entityType: "note",
        entityId: note.id,
        operation: "create",
        baseRevision: 0,
        queuedOrder: 2,
      },
    ] satisfies QueuedPendingChange[]);

    let pushedEntities: string[] = [];
    const apiClient: PushApiClient = {
      async syncPush(input: PushInput) {
        pushedEntities = input.changes.map(
          (change) => `${change.entityType}:${change.entityId}:${change.operation}`,
        );
        return {
          accepted: [
            { acceptedRevision: 101, cursor: 10 },
            { acceptedRevision: 202, cursor: 11 },
          ],
          conflicts: [],
        };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1");

    expect(pushedEntities).toEqual([
      "folder:folder_parent:create",
      "note:note_child:create",
    ]);
    await expect(db.folders.get(folder.id)).resolves.toMatchObject({ currentRevision: 101 });
    await expect(db.notes.get(note.id)).resolves.toMatchObject({ currentRevision: 202 });
  });

  it("pushes legacy note create before update when both changes lack queued order", async () => {
    const db = createWebDatabase(
      `test-markean-push-legacy-order-create-update-${crypto.randomUUID()}`,
    );
    const note: NoteRecord = {
      id: "note_legacy_ordered",
      folderId: "folder_1",
      title: "Edited before first sync",
      bodyMd: "Edited before first sync",
      bodyPlain: "Edited before first sync",
      currentRevision: 0,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await db.notes.put(note);
    await db.pendingChanges.bulkPut([
      {
        clientChangeId: "chg_z_create",
        entityType: "note",
        entityId: note.id,
        operation: "create",
        baseRevision: 0,
      },
      {
        clientChangeId: "chg_a_update",
        entityType: "note",
        entityId: note.id,
        operation: "update",
        baseRevision: 0,
      },
    ] satisfies PendingChange[]);

    let pushedOperations: string[] = [];
    const apiClient: PushApiClient = {
      async syncPush(input: PushInput) {
        pushedOperations = input.changes.map((change) => change.operation);
        return { accepted: [], conflicts: [] };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1");

    expect(pushedOperations).toEqual(["create", "update"]);
  });

  it("pushes legacy note create before delete when both changes lack queued order", async () => {
    const db = createWebDatabase(
      `test-markean-push-legacy-order-create-delete-${crypto.randomUUID()}`,
    );
    const note: NoteRecord = {
      id: "note_legacy_deleted_before_sync",
      folderId: "folder_1",
      title: "Deleted before first sync",
      bodyMd: "Deleted before first sync",
      bodyPlain: "Deleted before first sync",
      currentRevision: 0,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: "2026-04-21T09:05:00.000Z",
    };
    await db.notes.put(note);
    await db.pendingChanges.bulkPut([
      {
        clientChangeId: "chg_z_create",
        entityType: "note",
        entityId: note.id,
        operation: "create",
        baseRevision: 0,
      },
      {
        clientChangeId: "chg_a_delete",
        entityType: "note",
        entityId: note.id,
        operation: "delete",
        baseRevision: 0,
      },
    ] satisfies PendingChange[]);

    let pushedOperations: string[] = [];
    const apiClient: PushApiClient = {
      async syncPush(input: PushInput) {
        pushedOperations = input.changes.map((change) => change.operation);
        return { accepted: [], conflicts: [] };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1");

    expect(pushedOperations).toEqual(["create", "delete"]);
  });

  it("pushes legacy folder create before child note create when both changes lack queued order", async () => {
    const db = createWebDatabase(
      `test-markean-push-legacy-order-folder-note-${crypto.randomUUID()}`,
    );
    const folder: FolderRecord = {
      id: "folder_legacy_parent",
      name: "Parent",
      sortOrder: 1,
      currentRevision: 0,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    const note: NoteRecord = {
      id: "note_legacy_child",
      folderId: folder.id,
      title: "Child",
      bodyMd: "Child",
      bodyPlain: "Child",
      currentRevision: 0,
      updatedAt: "2026-04-21T09:01:00.000Z",
      deletedAt: null,
    };
    await db.folders.put(folder);
    await db.notes.put(note);
    await db.pendingChanges.bulkPut([
      {
        clientChangeId: "chg_z_folder_create",
        entityType: "folder",
        entityId: folder.id,
        operation: "create",
        baseRevision: 0,
      },
      {
        clientChangeId: "chg_a_note_create",
        entityType: "note",
        entityId: note.id,
        operation: "create",
        baseRevision: 0,
      },
    ] satisfies PendingChange[]);

    let pushedEntities: string[] = [];
    const apiClient: PushApiClient = {
      async syncPush(input: PushInput) {
        pushedEntities = input.changes.map(
          (change) => `${change.entityType}:${change.entityId}:${change.operation}`,
        );
        return {
          accepted: [
            { acceptedRevision: 303, cursor: 12 },
            { acceptedRevision: 404, cursor: 13 },
          ],
          conflicts: [],
        };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1");

    expect(pushedEntities).toEqual([
      "folder:folder_legacy_parent:create",
      "note:note_legacy_child:create",
    ]);
    await expect(db.folders.get(folder.id)).resolves.toMatchObject({ currentRevision: 303 });
    await expect(db.notes.get(note.id)).resolves.toMatchObject({ currentRevision: 404 });
  });

  it("pushes legacy child note update before parent folder delete when both changes lack queued order", async () => {
    const db = createWebDatabase(
      `test-markean-push-legacy-order-note-update-folder-delete-${crypto.randomUUID()}`,
    );
    const folder: FolderRecord = {
      id: "folder_legacy_deleted_parent",
      name: "Deleted parent",
      sortOrder: 1,
      currentRevision: 7,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: "2026-04-21T09:05:00.000Z",
    };
    const note: NoteRecord = {
      id: "note_legacy_updated_child",
      folderId: folder.id,
      title: "Updated child",
      bodyMd: "Updated child",
      bodyPlain: "Updated child",
      currentRevision: 11,
      updatedAt: "2026-04-21T09:04:00.000Z",
      deletedAt: null,
    };
    await db.folders.put(folder);
    await db.notes.put(note);
    await db.pendingChanges.bulkPut([
      {
        clientChangeId: "chg_a_folder_delete",
        entityType: "folder",
        entityId: folder.id,
        operation: "delete",
        baseRevision: folder.currentRevision,
      },
      {
        clientChangeId: "chg_z_note_update",
        entityType: "note",
        entityId: note.id,
        operation: "update",
        baseRevision: note.currentRevision,
      },
    ] satisfies PendingChange[]);

    let pushedEntities: string[] = [];
    const apiClient: PushApiClient = {
      async syncPush(input: PushInput) {
        pushedEntities = input.changes.map(
          (change) => `${change.entityType}:${change.entityId}:${change.operation}`,
        );
        return {
          accepted: [
            { acceptedRevision: 505, cursor: 14 },
            { acceptedRevision: 606, cursor: 15 },
          ],
          conflicts: [],
        };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1");

    expect(pushedEntities).toEqual([
      "note:note_legacy_updated_child:update",
      "folder:folder_legacy_deleted_parent:delete",
    ]);
    await expect(db.notes.get(note.id)).resolves.toMatchObject({ currentRevision: 505 });
    await expect(db.folders.get(folder.id)).resolves.toMatchObject({ currentRevision: 606 });
  });

  it("pushes legacy child note update before parent folder delete with unrelated legacy folder changes", async () => {
    const db = createWebDatabase(
      `test-markean-push-legacy-order-note-update-folder-delete-unrelated-${crypto.randomUUID()}`,
    );
    const folderA: FolderRecord = {
      id: "folder_a",
      name: "Deleted parent",
      sortOrder: 1,
      currentRevision: 7,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: "2026-04-21T09:05:00.000Z",
    };
    const folderZ: FolderRecord = {
      id: "folder_z",
      name: "Unrelated folder",
      sortOrder: 2,
      currentRevision: 13,
      updatedAt: "2026-04-21T09:02:00.000Z",
      deletedAt: null,
    };
    const note: NoteRecord = {
      id: "note_child_of_folder_a",
      folderId: folderA.id,
      title: "Updated child",
      bodyMd: "Updated child",
      bodyPlain: "Updated child",
      currentRevision: 11,
      updatedAt: "2026-04-21T09:04:00.000Z",
      deletedAt: null,
    };
    await db.folders.bulkPut([folderA, folderZ]);
    await db.notes.put(note);
    await db.pendingChanges.bulkPut([
      {
        clientChangeId: "chg_a_folder_a_delete",
        entityType: "folder",
        entityId: folderA.id,
        operation: "delete",
        baseRevision: folderA.currentRevision,
      },
      {
        clientChangeId: "chg_b_folder_z_update",
        entityType: "folder",
        entityId: folderZ.id,
        operation: "update",
        baseRevision: folderZ.currentRevision,
      },
      {
        clientChangeId: "chg_z_note_update",
        entityType: "note",
        entityId: note.id,
        operation: "update",
        baseRevision: note.currentRevision,
      },
    ] satisfies PendingChange[]);

    let pushedEntities: string[] = [];
    const apiClient: PushApiClient = {
      async syncPush(input: PushInput) {
        pushedEntities = input.changes.map(
          (change) => `${change.entityType}:${change.entityId}:${change.operation}`,
        );
        return { accepted: [], conflicts: [] };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1");

    expect(pushedEntities).toEqual([
      "folder:folder_z:update",
      "note:note_child_of_folder_a:update",
      "folder:folder_a:delete",
    ]);
  });

  it("pushes legacy child note delete before parent folder delete when both changes lack queued order", async () => {
    const db = createWebDatabase(
      `test-markean-push-legacy-order-note-delete-folder-delete-${crypto.randomUUID()}`,
    );
    const folder: FolderRecord = {
      id: "folder_legacy_delete_parent",
      name: "Deleted parent",
      sortOrder: 1,
      currentRevision: 7,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: "2026-04-21T09:05:00.000Z",
    };
    const note: NoteRecord = {
      id: "note_legacy_deleted_child",
      folderId: folder.id,
      title: "Deleted child",
      bodyMd: "Deleted child",
      bodyPlain: "Deleted child",
      currentRevision: 11,
      updatedAt: "2026-04-21T09:04:00.000Z",
      deletedAt: "2026-04-21T09:05:00.000Z",
    };
    await db.folders.put(folder);
    await db.notes.put(note);
    await db.pendingChanges.bulkPut([
      {
        clientChangeId: "chg_a_folder_delete",
        entityType: "folder",
        entityId: folder.id,
        operation: "delete",
        baseRevision: folder.currentRevision,
      },
      {
        clientChangeId: "chg_z_note_delete",
        entityType: "note",
        entityId: note.id,
        operation: "delete",
        baseRevision: note.currentRevision,
      },
    ] satisfies PendingChange[]);

    let pushedEntities: string[] = [];
    const apiClient: PushApiClient = {
      async syncPush(input: PushInput) {
        pushedEntities = input.changes.map(
          (change) => `${change.entityType}:${change.entityId}:${change.operation}`,
        );
        return { accepted: [], conflicts: [] };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1");

    expect(pushedEntities).toEqual([
      "note:note_legacy_deleted_child:delete",
      "folder:folder_legacy_delete_parent:delete",
    ]);
  });

  it("pushes legacy child note create before parent folder delete when both changes lack queued order", async () => {
    const db = createWebDatabase(
      `test-markean-push-legacy-order-note-create-folder-delete-${crypto.randomUUID()}`,
    );
    const folder: FolderRecord = {
      id: "folder_legacy_delete_parent_with_create",
      name: "Deleted parent",
      sortOrder: 1,
      currentRevision: 7,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: "2026-04-21T09:05:00.000Z",
    };
    const note: NoteRecord = {
      id: "note_legacy_created_child",
      folderId: folder.id,
      title: "Created child",
      bodyMd: "Created child",
      bodyPlain: "Created child",
      currentRevision: 0,
      updatedAt: "2026-04-21T09:04:00.000Z",
      deletedAt: null,
    };
    await db.folders.put(folder);
    await db.notes.put(note);
    await db.pendingChanges.bulkPut([
      {
        clientChangeId: "chg_a_folder_delete",
        entityType: "folder",
        entityId: folder.id,
        operation: "delete",
        baseRevision: folder.currentRevision,
      },
      {
        clientChangeId: "chg_z_note_create",
        entityType: "note",
        entityId: note.id,
        operation: "create",
        baseRevision: 0,
      },
    ] satisfies PendingChange[]);

    let pushedEntities: string[] = [];
    const apiClient: PushApiClient = {
      async syncPush(input: PushInput) {
        pushedEntities = input.changes.map(
          (change) => `${change.entityType}:${change.entityId}:${change.operation}`,
        );
        return { accepted: [], conflicts: [] };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1");

    expect(pushedEntities).toEqual([
      "note:note_legacy_created_child:create",
      "folder:folder_legacy_delete_parent_with_create:delete",
    ]);
  });

  it("reconciles accepted push changes even when shouldApply becomes false after server acceptance", async () => {
    const db = createWebDatabase(`test-markean-push-cancel-${crypto.randomUUID()}`);
    const note: NoteRecord = {
      id: "note_1",
      folderId: "folder_1",
      title: "Local title",
      bodyMd: "Local body",
      bodyPlain: "Local body",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await db.notes.put(note);
    await queueChange(db, {
      entityType: "note",
      entityId: note.id,
      operation: "update",
      baseRevision: note.currentRevision,
    });

    let active = true;
    const apiClient = {
      async syncPush() {
        active = false;
        return {
          accepted: [{ acceptedRevision: 2, cursor: 10 }],
          conflicts: [],
        };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1", { shouldApply: () => active });

    await expect(db.notes.get(note.id)).resolves.toEqual({
      ...note,
      currentRevision: 2,
    });
    await expect(db.pendingChanges.toArray()).resolves.toHaveLength(0);
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "10",
    });
  });

  it("does not regress sync cursor while reconciling accepted push changes", async () => {
    const db = createWebDatabase(`test-markean-push-cursor-monotonic-${crypto.randomUUID()}`);
    const note: NoteRecord = {
      id: "note_1",
      folderId: "folder_1",
      title: "Local title",
      bodyMd: "Local body",
      bodyPlain: "Local body",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await db.notes.put(note);
    await db.syncState.put({ key: "syncCursor", value: "50" });
    await queueChange(db, {
      entityType: "note",
      entityId: note.id,
      operation: "update",
      baseRevision: note.currentRevision,
    });

    const apiClient = {
      async syncPush() {
        return {
          accepted: [{ acceptedRevision: 2, cursor: 10 }],
          conflicts: [],
        };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1");

    await expect(db.notes.get(note.id)).resolves.toEqual({
      ...note,
      currentRevision: 2,
    });
    await expect(db.pendingChanges.toArray()).resolves.toHaveLength(0);
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "50",
    });
  });

  it("does not push changes when shouldApply becomes false during payload construction", async () => {
    const db = createWebDatabase(`test-markean-push-payload-cancel-${crypto.randomUUID()}`);
    const note: NoteRecord = {
      id: "note_1",
      folderId: "folder_1",
      title: "Local title",
      bodyMd: "Local body",
      bodyPlain: "Local body",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await db.notes.put(note);
    await queueChange(db, {
      entityType: "note",
      entityId: note.id,
      operation: "update",
      baseRevision: note.currentRevision,
    });

    const originalGet = db.notes.get.bind(db.notes);
    let active = true;
    db.notes.get = (async (key: string) => {
      const result = await originalGet(key);
      active = false;
      return result;
    }) as typeof db.notes.get;
    let syncPushCalled = false;
    const apiClient = {
      async syncPush() {
        syncPushCalled = true;
        return {
          accepted: [{ acceptedRevision: 2, cursor: 10 }],
          conflicts: [],
        };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1", { shouldApply: () => active });

    expect(syncPushCalled).toBe(false);
    await expect(db.notes.get(note.id)).resolves.toEqual(note);
    await expect(db.pendingChanges.toArray()).resolves.toHaveLength(1);
    await expect(db.syncState.get("syncCursor")).resolves.toBeUndefined();
  });

  it("fully reconciles accepted push changes when shouldApply becomes false during revision update", async () => {
    const db = createWebDatabase(`test-markean-push-inflight-cancel-${crypto.randomUUID()}`);
    const note: NoteRecord = {
      id: "note_1",
      folderId: "folder_1",
      title: "Local title",
      bodyMd: "Local body",
      bodyPlain: "Local body",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    await db.notes.put(note);
    await queueChange(db, {
      entityType: "note",
      entityId: note.id,
      operation: "update",
      baseRevision: note.currentRevision,
    });

    const originalUpdate = db.notes.update.bind(db.notes);
    let active = true;
    db.notes.update = (async (key, changes) => {
      const result = await originalUpdate(key, changes);
      active = false;
      return result;
    }) as typeof db.notes.update;
    const apiClient = {
      async syncPush() {
        return {
          accepted: [{ acceptedRevision: 2, cursor: 10 }],
          conflicts: [],
        };
      },
      async syncPull() {
        throw new Error("syncPull should not be called");
      },
    };

    await pushChanges(db, apiClient, "device_1", { shouldApply: () => active });

    await expect(db.notes.get(note.id)).resolves.toEqual({
      ...note,
      currentRevision: 2,
    });
    await expect(db.pendingChanges.toArray()).resolves.toHaveLength(0);
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "10",
    });
  });

  it("does not apply pulled events when shouldApply becomes false", async () => {
    const db = createWebDatabase(`test-markean-pull-cancel-${crypto.randomUUID()}`);
    const pulledFolder: FolderRecord = {
      id: "folder_pulled",
      name: "Pulled",
      sortOrder: 1,
      currentRevision: 8,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };

    let active = true;
    const apiClient = {
      async syncPush() {
        throw new Error("syncPush should not be called");
      },
      async syncPull() {
        active = false;
        return {
          nextCursor: 9,
          events: [
            {
              cursor: 9,
              entityType: "folder",
              entityId: pulledFolder.id,
              operation: "create",
              revisionNumber: pulledFolder.currentRevision,
              sourceDeviceId: "server_device",
              entity: pulledFolder,
            },
          ],
        };
      },
    };

    await pullChanges(db, apiClient, "device_1", { shouldApply: () => active });

    await expect(db.folders.get(pulledFolder.id)).resolves.toBeUndefined();
    await expect(db.syncState.get("syncCursor")).resolves.toBeUndefined();
  });

  it("does not apply stale pulled events or regress cursor when local cursor advances during pull", async () => {
    const db = createWebDatabase(`test-markean-pull-cursor-race-${crypto.randomUUID()}`);
    const localFolder: FolderRecord = {
      id: "folder_race",
      name: "Current",
      sortOrder: 0,
      currentRevision: 50,
      updatedAt: "2026-04-23T10:00:00.000Z",
      deletedAt: null,
    };
    const staleFolder: FolderRecord = {
      ...localFolder,
      name: "Stale",
      currentRevision: 4,
      updatedAt: "2026-04-22T10:00:00.000Z",
    };
    await db.folders.put(localFolder);
    await db.syncState.put({ key: "syncCursor", value: "3" });

    const apiClient = {
      async syncPush() {
        throw new Error("syncPush should not be called");
      },
      async syncPull(cursor: number) {
        expect(cursor).toBe(3);
        await db.syncState.put({ key: "syncCursor", value: "50" });
        return {
          nextCursor: 10,
          events: [
            {
              cursor: 4,
              entityType: "folder",
              entityId: staleFolder.id,
              operation: "update",
              revisionNumber: staleFolder.currentRevision,
              sourceDeviceId: "server_device",
              entity: staleFolder,
            },
          ],
        };
      },
    };

    await pullChanges(db, apiClient, "device_1");

    await expect(db.folders.get(localFolder.id)).resolves.toEqual(localFolder);
    await expect(db.syncState.get("syncCursor")).resolves.toEqual({
      key: "syncCursor",
      value: "50",
    });
  });

  it("rolls back pulled notes when shouldApply becomes false during note put", async () => {
    const db = createWebDatabase(`test-markean-pull-inflight-cancel-${crypto.randomUUID()}`);
    const pulledNote: NoteRecord = {
      id: "note_pulled",
      folderId: "folder_pulled",
      title: "Pulled",
      bodyMd: "# Pulled",
      bodyPlain: "Pulled",
      currentRevision: 8,
      updatedAt: "2026-04-22T10:00:00.000Z",
      deletedAt: null,
    };

    const originalPut = db.notes.put.bind(db.notes);
    let active = true;
    db.notes.put = (async (value) => {
      const result = await originalPut(value);
      active = false;
      return result;
    }) as typeof db.notes.put;
    const apiClient = {
      async syncPush() {
        throw new Error("syncPush should not be called");
      },
      async syncPull() {
        return {
          nextCursor: 9,
          events: [
            {
              cursor: 9,
              entityType: "note",
              entityId: pulledNote.id,
              operation: "create",
              revisionNumber: pulledNote.currentRevision,
              sourceDeviceId: "server_device",
              entity: pulledNote,
            },
          ],
        };
      },
    };

    await pullChanges(db, apiClient, "device_1", { shouldApply: () => active });

    await expect(db.notes.get(pulledNote.id)).resolves.toBeUndefined();
    await expect(db.syncState.get("syncCursor")).resolves.toBeUndefined();
  });
});
