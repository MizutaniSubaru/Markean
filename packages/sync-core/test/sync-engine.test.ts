import "fake-indexeddb/auto";

import type { FolderRecord, NoteRecord, PendingChange } from "@markean/domain";
import { describe, expect, it } from "vitest";
import { createWebDatabase } from "../../storage-web/src/index";
import { getDeviceId, pullChanges, pushChanges, queueChange } from "../src/index";

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

  it("does not apply accepted push changes when shouldApply becomes false", async () => {
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

    await expect(db.notes.get(note.id)).resolves.toEqual(note);
    await expect(db.pendingChanges.toArray()).resolves.toHaveLength(1);
    await expect(db.syncState.get("syncCursor")).resolves.toBeUndefined();
  });

  it("rolls back accepted push changes when shouldApply becomes false during revision update", async () => {
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

    await expect(db.notes.get(note.id)).resolves.toEqual(note);
    await expect(db.pendingChanges.toArray()).resolves.toHaveLength(1);
    await expect(db.syncState.get("syncCursor")).resolves.toBeUndefined();
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
