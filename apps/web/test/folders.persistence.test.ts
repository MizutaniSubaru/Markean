import "fake-indexeddb/auto";

import type { FolderRecord, NoteRecord } from "@markean/domain";
import { createWebDatabase } from "@markean/storage-web";
import { pushChanges } from "@markean/sync-core";
import { afterEach, describe, expect, it } from "vitest";
import { initDb, resetDbForTests } from "../src/features/notes/persistence/db";
import { deleteFolder } from "../src/features/notes/persistence/folders.persistence";

describe("folders persistence sync queue", () => {
  afterEach(() => {
    resetDbForTests();
  });

  it("queues changed active child note deletes before deleting a folder", async () => {
    const db = createWebDatabase(`test-markean-folder-delete-children-${crypto.randomUUID()}`);
    initDb(db);
    const folder: FolderRecord = {
      id: "folder_1",
      name: "Inbox",
      sortOrder: 1,
      currentRevision: 1,
      updatedAt: "2026-04-21T09:00:00.000Z",
      deletedAt: null,
    };
    const changedChild: NoteRecord = {
      id: "note_changed",
      folderId: folder.id,
      title: "Changed child",
      bodyMd: "Changed child",
      bodyPlain: "Changed child",
      currentRevision: 2,
      updatedAt: "2026-04-21T09:05:00.000Z",
      deletedAt: null,
    };
    const unchangedChild: NoteRecord = {
      id: "note_unchanged",
      folderId: folder.id,
      title: "Unchanged child",
      bodyMd: "Unchanged child",
      bodyPlain: "Unchanged child",
      currentRevision: 1,
      updatedAt: "2026-04-21T09:06:00.000Z",
      deletedAt: null,
    };
    const alreadyDeletedChild: NoteRecord = {
      id: "note_deleted",
      folderId: folder.id,
      title: "Deleted child",
      bodyMd: "Deleted child",
      bodyPlain: "Deleted child",
      currentRevision: 3,
      updatedAt: "2026-04-21T09:07:00.000Z",
      deletedAt: "2026-04-21T09:08:00.000Z",
    };
    await db.folders.put(folder);
    await db.notes.bulkPut([changedChild, unchangedChild, alreadyDeletedChild]);

    await deleteFolder(folder.id);

    const pending = await db.pendingChanges.orderBy("queuedOrder").toArray();
    expect(pending).toMatchObject([
      {
        entityType: "note",
        entityId: changedChild.id,
        operation: "delete",
        baseRevision: 2,
      },
      {
        entityType: "folder",
        entityId: folder.id,
        operation: "delete",
        baseRevision: 1,
      },
    ]);

    const pushedChanges: Parameters<Parameters<typeof pushChanges>[1]["syncPush"]>[0]["changes"][] = [];
    const result = await pushChanges(
      db,
      {
        async syncPush(input) {
          pushedChanges.push(input.changes);
          return {
            accepted: [
              { acceptedRevision: 3, cursor: 1 },
              { acceptedRevision: 2, cursor: 2 },
            ],
            conflicts: [],
          };
        },
        async syncPull() {
          throw new Error("syncPull should not be called");
        },
      },
      "device_1",
    );

    expect(result.conflicts).toEqual([]);
    expect(pushedChanges).toEqual([
      [
        {
          clientChangeId: expect.any(String),
          entityType: "note",
          entityId: changedChild.id,
          operation: "delete",
          baseRevision: 2,
          payload: null,
        },
        {
          clientChangeId: expect.any(String),
          entityType: "folder",
          entityId: folder.id,
          operation: "delete",
          baseRevision: 1,
          payload: null,
        },
      ],
    ]);
  });
});
