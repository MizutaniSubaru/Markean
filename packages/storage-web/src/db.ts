import Dexie, { type Table } from "dexie";
import type { NoteRecord, PendingChange } from "@markean/domain";

type SyncStateRecord = {
  key: string;
  value: string;
};

export class MarkeanWebDatabase extends Dexie {
  notes!: Table<NoteRecord, string>;
  pendingChanges!: Table<PendingChange, string>;
  syncState!: Table<SyncStateRecord, string>;

  constructor(name: string) {
    super(name);

    this.version(1).stores({
      notes: "id, folderId, updatedAt",
      pendingChanges: "clientChangeId, entityId, operation",
      syncState: "key",
    });
  }
}

export function createWebDatabase(name = "markean") {
  return new MarkeanWebDatabase(name);
}
