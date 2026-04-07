import { createNoteRecord, createPendingChange } from "@markean/domain";

type WritableStore = {
  put(value: unknown): Promise<unknown>;
};

type QueueDatabase = {
  transaction: unknown;
  notes: WritableStore;
  pendingChanges: WritableStore;
};

type TransactionRunner<TDb extends QueueDatabase> = <T>(
  this: TDb,
  mode: "rw",
  notes: TDb["notes"],
  pendingChanges: TDb["pendingChanges"],
  scope: () => Promise<T>,
) => PromiseLike<T>;

export async function queueNoteUpdate<TDb extends QueueDatabase>(
  db: TDb,
  input: {
    noteId: string;
    folderId: string;
    title: string;
    bodyMd: string;
  }
) {
  const note = createNoteRecord({
    id: input.noteId,
    folderId: input.folderId,
    title: input.title,
    bodyMd: input.bodyMd,
  });

  const change = createPendingChange({
    entityType: "note",
    entityId: input.noteId,
    operation: "update",
    baseRevision: note.currentRevision,
  });

  const runTransaction = db.transaction as TransactionRunner<TDb>;

  await runTransaction.call(db, "rw", db.notes, db.pendingChanges, async () => {
    await db.notes.put(note);
    await db.pendingChanges.put(change);
  });
}
