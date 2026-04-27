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
    delete?(key: string): Promise<unknown>;
  };
  transaction?: unknown;
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

type SyncApplyOptions = {
  shouldApply?: () => boolean;
};

function shouldApply(options?: SyncApplyOptions): boolean {
  return options?.shouldApply?.() ?? true;
}

class StaleSyncApplicationError extends Error {
  constructor() {
    super("Stale sync application");
  }
}

function assertShouldApply(options: SyncApplyOptions): void {
  if (!shouldApply(options)) {
    throw new StaleSyncApplicationError();
  }
}

function hasTransaction(
  db: SyncableDatabase,
): db is SyncableDatabase & { transaction: (...args: unknown[]) => Promise<unknown> } {
  return typeof db.transaction === "function";
}

async function applyLocalSyncChanges(
  db: SyncableDatabase,
  options: SyncApplyOptions,
  apply: () => Promise<void>,
): Promise<boolean> {
  try {
    if (hasTransaction(db)) {
      await db.transaction(
        "rw",
        db.notes,
        db.folders,
        db.pendingChanges,
        db.syncState,
        async () => {
          assertShouldApply(options);
          await apply();
          assertShouldApply(options);
        },
      );
      return true;
    }

    assertShouldApply(options);
    await apply();
    assertShouldApply(options);
    return true;
  } catch (error) {
    if (error instanceof StaleSyncApplicationError) {
      return false;
    }
    throw error;
  }
}

async function applyAcceptedPushChanges(
  db: SyncableDatabase,
  acceptedChanges: PendingChange[],
  accepted: Array<{ acceptedRevision: number; cursor: number }>,
): Promise<void> {
  await applyLocalSyncChanges(db, {}, async () => {
    for (const [index, serverAccepted] of accepted.entries()) {
      const change = acceptedChanges[index];
      if (!change) continue;

      if (change.entityType === "note") {
        await db.notes.update(change.entityId, {
          currentRevision: serverAccepted.acceptedRevision,
        });
      } else {
        await db.folders.update(change.entityId, {
          currentRevision: serverAccepted.acceptedRevision,
        });
      }
    }

    if (accepted.length > 0) {
      const acceptedIds = acceptedChanges.map((change) => change.clientChangeId);
      await db.pendingChanges.where("clientChangeId").anyOf(acceptedIds).delete();
    }

    const latestCursor = accepted.at(-1)?.cursor;
    if (latestCursor !== undefined) {
      const currentCursorRecord = await db.syncState.get("syncCursor");
      const currentCursor = currentCursorRecord ? Number(currentCursorRecord.value) : 0;
      const nextCursor = Math.max(
        Number.isFinite(currentCursor) ? currentCursor : 0,
        latestCursor,
      );
      await db.syncState.put({ key: "syncCursor", value: String(nextCursor) });
    }
  });
}

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
  options: SyncApplyOptions = {},
): Promise<{ conflicts: Array<{ entityType: string; entityId: string; serverRevision: number }> }> {
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

  await applyAcceptedPushChanges(db, acceptedChanges, result.accepted);

  return { conflicts: result.conflicts ?? [] };
}

export async function pullChanges(
  db: SyncableDatabase,
  apiClient: ApiClient,
  deviceId: string,
  options: SyncApplyOptions = {},
): Promise<void> {
  const cursorRecord = await db.syncState.get("syncCursor");
  const cursor = cursorRecord ? Number(cursorRecord.value) : 0;

  const result = await apiClient.syncPull(cursor);
  if (!shouldApply(options)) return;

  await applyLocalSyncChanges(db, options, async () => {
    for (const event of result.events) {
      if (event.sourceDeviceId === deviceId) continue;
      assertShouldApply(options);

      if (event.operation === "delete") {
        if (event.entityType === "note") {
          await db.notes.update(event.entityId, { deletedAt: new Date().toISOString() });
        } else {
          await db.folders.update(event.entityId, { deletedAt: new Date().toISOString() });
        }
        assertShouldApply(options);
        continue;
      }

      if (!event.entity) continue;

      if (event.entityType === "note") {
        assertShouldApply(options);
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
        assertShouldApply(options);
      } else {
        assertShouldApply(options);
        await db.folders.put({
          id: event.entity.id as string,
          name: event.entity.name as string,
          sortOrder: event.entity.sortOrder as number,
          currentRevision: event.entity.currentRevision as number,
          updatedAt: event.entity.updatedAt as string,
          deletedAt: (event.entity.deletedAt as string) ?? null,
        });
        assertShouldApply(options);
      }
    }

    assertShouldApply(options);
    await db.syncState.put({ key: "syncCursor", value: String(result.nextCursor) });
    assertShouldApply(options);
  });
}

export function getDeviceId(db: SyncableDatabase): Promise<string>;
export function getDeviceId(
  db: SyncableDatabase,
  options: SyncApplyOptions,
): Promise<string | null>;
export async function getDeviceId(
  db: SyncableDatabase,
  options: SyncApplyOptions = {},
): Promise<string | null> {
  if (hasTransaction(db)) {
    let deviceId: string | null = null;
    try {
      await db.transaction("rw", db.syncState, async () => {
        const existing = await db.syncState.get("deviceId");
        if (existing) {
          deviceId = existing.value;
          return;
        }

        assertShouldApply(options);
        const generatedDeviceId = `dev_${crypto.randomUUID()}`;
        assertShouldApply(options);
        await db.syncState.put({ key: "deviceId", value: generatedDeviceId });
        assertShouldApply(options);
        deviceId = generatedDeviceId;
      });
      return deviceId;
    } catch (error) {
      if (error instanceof StaleSyncApplicationError) {
        return null;
      }
      throw error;
    }
  }

  const existing = await db.syncState.get("deviceId");
  if (existing) return existing.value;

  if (!shouldApply(options)) return null;
  const deviceId = `dev_${crypto.randomUUID()}`;
  if (!shouldApply(options)) return null;
  await db.syncState.put({ key: "deviceId", value: deviceId });
  if (!shouldApply(options)) {
    const stored = await db.syncState.get("deviceId");
    if (stored?.value === deviceId && db.syncState.delete) {
      await db.syncState.delete("deviceId");
    }
    return null;
  }
  return deviceId;
}

export async function runSyncCycle(
  db: SyncableDatabase,
  apiClient: ApiClient,
): Promise<{ conflicts: Array<{ entityType: string; entityId: string; serverRevision: number }> }> {
  const deviceId = await getDeviceId(db);
  if (!deviceId) return { conflicts: [] };
  const { conflicts } = await pushChanges(db, apiClient, deviceId);
  await pullChanges(db, apiClient, deviceId);
  return { conflicts };
}
