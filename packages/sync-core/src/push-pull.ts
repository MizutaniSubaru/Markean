import { createPendingChange } from "@markean/domain";
import type { PendingChange, NoteRecord, FolderRecord } from "@markean/domain";

type SyncableDatabase = {
  pendingChanges: {
    toArray(): Promise<PendingChange[]>;
    where(field: string): {
      anyOf(keys: string[]): { delete(): Promise<number> };
    };
    put(value: PendingChange): Promise<unknown>;
  };
  notes: {
    get(key: string): Promise<NoteRecord | undefined>;
    put(value: NoteRecord): Promise<unknown>;
    update(key: string, changes: Partial<NoteRecord>): Promise<number>;
  };
  folders: {
    get(key: string): Promise<FolderRecord | undefined>;
    put(value: FolderRecord): Promise<unknown>;
    update(key: string, changes: Partial<FolderRecord>): Promise<number>;
  };
  syncState: {
    get(key: string): Promise<{ key: string; value: string } | undefined>;
    put(value: { key: string; value: string }): Promise<unknown>;
  };
};

type ApiClient = {
  syncPush(input: {
    deviceId: string;
    changes: Array<{
      clientChangeId: string;
      entityType: string;
      entityId: string;
      operation: string;
      baseRevision: number;
      payload: Record<string, unknown> | null;
    }>;
  }): Promise<{
    accepted: Array<{ acceptedRevision: number; cursor: number }>;
    conflicts?: Array<{ entityType: string; entityId: string; serverRevision: number }>;
  }>;
  syncPull(cursor: number): Promise<{
    nextCursor: number;
    events: Array<{
      cursor: number;
      entityType: string;
      entityId: string;
      operation: string;
      revisionNumber: number;
      sourceDeviceId: string;
      entity: Record<string, unknown> | null;
    }>;
  }>;
};

type SyncConflict = {
  entityType: string;
  entityId: string;
  serverRevision: number;
};

export function queueChange(
  db: SyncableDatabase,
  input: Omit<PendingChange, "clientChangeId">,
): Promise<unknown> {
  const change = createPendingChange(input);
  return db.pendingChanges.put(change);
}

export async function pushChanges(
  db: SyncableDatabase,
  apiClient: ApiClient,
  deviceId: string,
): Promise<{ conflicts: SyncConflict[] }> {
  const pending = await db.pendingChanges.toArray();
  if (pending.length === 0) return { conflicts: [] };

  const changes = [];
  for (const p of pending) {
    let payload: Record<string, unknown> | null = null;

    if (p.operation !== "delete") {
      if (p.entityType === "note") {
        const note = await db.notes.get(p.entityId);
        if (note) {
          payload = { folderId: note.folderId, title: note.title, bodyMd: note.bodyMd };
        }
      } else {
        const folder = await db.folders.get(p.entityId);
        if (folder) {
          payload = { name: folder.name, sortOrder: folder.sortOrder };
        }
      }
    }

    changes.push({
      clientChangeId: p.clientChangeId,
      entityType: p.entityType,
      entityId: p.entityId,
      operation: p.operation,
      baseRevision: p.baseRevision,
      payload,
    });
  }

  const result = await apiClient.syncPush({ deviceId, changes });
  const acceptedChanges = pending.slice(0, result.accepted.length);

  for (const [index, accepted] of result.accepted.entries()) {
    const change = acceptedChanges[index];
    if (!change) continue;

    if (change.entityType === "note") {
      await db.notes.update(change.entityId, { currentRevision: accepted.acceptedRevision });
    } else {
      await db.folders.update(change.entityId, { currentRevision: accepted.acceptedRevision });
    }
  }

  if (result.accepted.length > 0) {
    const acceptedIds = acceptedChanges.map((p) => p.clientChangeId);
    await db.pendingChanges.where("clientChangeId").anyOf(acceptedIds).delete();
  }

  const latestCursor = result.accepted.at(-1)?.cursor;
  if (latestCursor !== undefined) {
    await db.syncState.put({ key: "syncCursor", value: String(latestCursor) });
  }

  return { conflicts: result.conflicts ?? [] };
}

export async function pullChanges(
  db: SyncableDatabase,
  apiClient: ApiClient,
  deviceId: string,
): Promise<void> {
  const cursorRecord = await db.syncState.get("syncCursor");
  const cursor = cursorRecord ? Number(cursorRecord.value) : 0;

  const result = await apiClient.syncPull(cursor);

  for (const event of result.events) {
    if (event.sourceDeviceId === deviceId) continue;

    if (event.operation === "delete") {
      if (event.entityType === "note") {
        await db.notes.update(event.entityId, { deletedAt: new Date().toISOString() });
      } else {
        await db.folders.update(event.entityId, { deletedAt: new Date().toISOString() });
      }
      continue;
    }

    if (!event.entity) continue;

    if (event.entityType === "note") {
      await db.notes.put({
        id: event.entity.id as string,
        folderId: event.entity.folderId as string,
        title: event.entity.title as string,
        bodyMd: event.entity.bodyMd as string,
        bodyPlain: event.entity.bodyPlain as string,
        currentRevision: event.entity.currentRevision as number,
        updatedAt: event.entity.updatedAt as string,
        deletedAt: (event.entity.deletedAt as string) ?? null,
      });
    } else {
      await db.folders.put({
        id: event.entity.id as string,
        name: event.entity.name as string,
        sortOrder: event.entity.sortOrder as number,
        currentRevision: event.entity.currentRevision as number,
        updatedAt: event.entity.updatedAt as string,
        deletedAt: (event.entity.deletedAt as string) ?? null,
      });
    }
  }

  await db.syncState.put({ key: "syncCursor", value: String(result.nextCursor) });
}

export async function getDeviceId(db: SyncableDatabase): Promise<string> {
  const existing = await db.syncState.get("deviceId");
  if (existing) return existing.value;

  const deviceId = `dev_${crypto.randomUUID()}`;
  await db.syncState.put({ key: "deviceId", value: deviceId });
  return deviceId;
}

export async function runSyncCycle(
  db: SyncableDatabase,
  apiClient: ApiClient,
): Promise<{ conflicts: SyncConflict[] }> {
  const deviceId = await getDeviceId(db);
  const { conflicts } = await pushChanges(db, apiClient, deviceId);
  await pullChanges(db, apiClient, deviceId);
  return { conflicts };
}
