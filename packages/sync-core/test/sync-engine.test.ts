import "fake-indexeddb/auto";

import type { FolderRecord, NoteRecord } from "@markean/domain";
import { describe, expect, it } from "vitest";
import { createWebDatabase } from "../../storage-web/src/index";
import { getDeviceId, pullChanges, pushChanges, queueChange } from "../src/index";

describe("sync engine queue", () => {
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
});
