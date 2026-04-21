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
      baseRevision: 0,
    });
  });

  it("reads all folders", async () => {
    await createFolder(folder);
    const all = await getAllFolders();
    expect(all).toHaveLength(1);
  });

  it("soft-deletes a folder and queues a pending change", async () => {
    await createFolder({ ...folder, currentRevision: 3 });
    await deleteFolder("folder_1");

    const stored = await db.folders.get("folder_1");
    expect(stored?.deletedAt).not.toBeNull();

    const changes = await db.pendingChanges.toArray();
    const deleteChange = changes.find((change) => change.operation === "delete");
    expect(deleteChange).toMatchObject({
      entityType: "folder",
      entityId: "folder_1",
      operation: "delete",
      baseRevision: 3,
    });
  });
});
