import "fake-indexeddb/auto";

import type { FolderRecord } from "@markean/domain";
import { createWebDatabase, type MarkeanWebDatabase } from "@markean/storage-web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initDb, resetDbForTests } from "../../src/features/notes/persistence/db";
import {
  createFolder,
  deleteFolder,
  getAllFolders,
} from "../../src/features/notes/persistence/folders.persistence";

const folder1: FolderRecord = {
  id: "folder_1",
  name: "Notes",
  sortOrder: 0,
  currentRevision: 5,
  updatedAt: "2026-04-21T09:00:00.000Z",
  deletedAt: null,
};

const folder2: FolderRecord = {
  id: "folder_2",
  name: "Archive",
  sortOrder: 1,
  currentRevision: 6,
  updatedAt: "2026-04-22T10:00:00.000Z",
  deletedAt: null,
};

describe("folders.persistence", () => {
  let db: MarkeanWebDatabase;

  beforeEach(() => {
    db = createWebDatabase(`test-folders-persistence-${crypto.randomUUID()}`);
    resetDbForTests();
    initDb(db);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.delete();
    resetDbForTests();
  });

  it("creating a folder writes it and queues a create change", async () => {
    await createFolder(folder1);

    expect(await db.folders.get("folder_1")).toEqual(folder1);
    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(1);
    const [change] = changes;
    expect(change).toMatchObject({
      entityType: "folder",
      entityId: "folder_1",
      operation: "create",
      baseRevision: 0,
    });
    expect(change.clientChangeId).toMatch(/^chg_/);
  });

  it("rolls back folder creation when queueing the pending change fails", async () => {
    db.pendingChanges.hook("creating", () => {
      throw new Error("pending change failed");
    });

    await expect(createFolder(folder1)).rejects.toThrow("pending change failed");

    await expect(db.folders.toArray()).resolves.toEqual([]);
    await expect(db.pendingChanges.toArray()).resolves.toHaveLength(0);
  });

  it("reads all folders", async () => {
    await db.folders.bulkPut([folder1, folder2]);

    await expect(getAllFolders()).resolves.toEqual([folder1, folder2]);
  });

  it("soft-deleting a folder writes deletedAt and queues a delete change", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));
    await db.folders.put(folder1);

    await deleteFolder("folder_1");

    await expect(db.folders.get("folder_1")).resolves.toEqual({
      ...folder1,
      deletedAt: "2026-04-27T12:34:56.789Z",
    });
    const changes = await db.pendingChanges.toArray();
    expect(changes).toHaveLength(1);
    const [change] = changes;
    expect(change).toMatchObject({
      entityType: "folder",
      entityId: "folder_1",
      operation: "delete",
      baseRevision: 5,
    });
  });

  it("rolls back folder deletion when queueing the pending change fails", async () => {
    await db.folders.put(folder1);
    db.pendingChanges.hook("creating", () => {
      throw new Error("pending change failed");
    });

    await expect(deleteFolder("folder_1")).rejects.toThrow("pending change failed");

    await expect(db.folders.get("folder_1")).resolves.toEqual(folder1);
    await expect(db.pendingChanges.toArray()).resolves.toHaveLength(0);
  });

  it("deleting a missing folder does nothing and queues no change", async () => {
    await deleteFolder("missing");

    await expect(db.folders.toArray()).resolves.toEqual([]);
    await expect(db.pendingChanges.toArray()).resolves.toEqual([]);
  });
});
